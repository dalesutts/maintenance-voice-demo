const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const Anthropic = require('@anthropic-ai/sdk').default;
const fs = require('fs');
const crypto = require('crypto');

// Tool handlers
const { lookupProperty, lookupPropertyTool } = require('./tools/lookup-property');
const { classifyAndEvaluate, classifyAndEvaluateTool } = require('./tools/classify-and-evaluate');
const { collectAvailability, collectAvailabilityTool } = require('./tools/collect-availability');
const { createServiceRequest, createServiceRequestTool } = require('./tools/create-sr');
const { sendPhotoSms, sendPhotoSmsTool } = require('./tools/send-photo-sms');
const { routeAndEnd, routeAndEndTool } = require('./tools/route-and-end');
const { cleanForVoice, enforceBrevity } = require('./post-process');

// --- Configuration ---
const PORT = process.env.PORT || 8080;
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001'; // Haiku for voice-grade latency

const anthropic = new Anthropic({
  apiKey: process.env.LLM_API_KEY,
});

// Load system prompt
const systemPrompt = fs.readFileSync(
  path.join(__dirname, 'prompts', 'system-prompt.md'),
  'utf-8'
);

// All tool definitions for Claude
const tools = [
  lookupPropertyTool,
  classifyAndEvaluateTool,
  collectAvailabilityTool,
  createServiceRequestTool,
  sendPhotoSmsTool,
  routeAndEndTool,
];

// Tool execution dispatcher
const toolHandlers = {
  lookup_property: lookupProperty,
  classify_and_evaluate: classifyAndEvaluate,
  collect_availability: collectAvailability,
  create_service_request: createServiceRequest,
  send_photo_sms: sendPhotoSms,
  route_and_end_call: routeAndEnd,
};

// --- Express App ---
const app = express();
const cors = require('cors');

// CORS: restrict to known origins. Configure via ALLOWED_ORIGINS env var
// (comma-separated). Defaults cover local dev and the Render demo host.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
  'http://localhost:8080,https://maintenance-voice-demo.onrender.com')
  .split(',').map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow same-origin / curl (no Origin header) and any configured origin.
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`Origin ${origin} not allowed`));
  },
}));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'maintenance-voice-demo' });
});

// Short-lived SSE subscription tokens keyed by callId. Issued at call creation,
// required on GET /events/:callId, auto-expire 1 hour after issue.
const sseTokens = new Map(); // callId -> { token, expiresAt }
const SSE_TOKEN_TTL_MS = 60 * 60 * 1000;

function issueSseToken(callId) {
  const token = crypto.randomBytes(24).toString('hex');
  const expiresAt = Date.now() + SSE_TOKEN_TTL_MS;
  sseTokens.set(callId, { token, expiresAt });
  setTimeout(() => {
    const current = sseTokens.get(callId);
    if (current && current.token === token) sseTokens.delete(callId);
  }, SSE_TOKEN_TTL_MS).unref?.();
  return token;
}

// Web Call Registration Endpoint
// If DEMO_SECRET is set in env, require the `X-Demo-Secret` header to match.
// This lets Sutton share the Render URL selectively without burning Retell/Claude
// credits if the URL leaks.
app.post('/create-web-call', async (req, res) => {
  if (process.env.DEMO_SECRET) {
    const provided = req.get('x-demo-secret') || req.body?.demo_secret;
    if (provided !== process.env.DEMO_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }
  try {
    const Retell = require('retell-sdk').default;
    const client = new Retell({ apiKey: process.env.RETELL_API_KEY });
    const webCall = await client.call.createWebCall({
      agent_id: req.body.agent_id || process.env.RETELL_AGENT_ID,
    });
    const sseToken = issueSseToken(webCall.call_id);
    res.json({
      access_token: webCall.access_token,
      call_id: webCall.call_id,
      sse_token: sseToken,
    });
  } catch (error) {
    console.error('Failed to create web call:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Serve the test page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});
app.use(express.static(path.join(__dirname, '..', 'public')));

// --- Server-Sent Events for live UI updates ---
const sseClients = new Map(); // callId -> Set of response objects

app.get('/events/:callId', (req, res) => {
  const callId = req.params.callId;

  // Require a valid short-lived token issued at call creation time.
  // This prevents anyone who guesses / overhears a callId from tapping the
  // live tool-result stream (which includes resident PII).
  const provided = req.query.token;
  const entry = sseTokens.get(callId);
  if (!entry || entry.token !== provided || entry.expiresAt < Date.now()) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const origin = req.get('origin');
  const allowOrigin = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': allowOrigin,
  });
  res.write('data: {"type":"connected"}\n\n');

  if (!sseClients.has(callId)) sseClients.set(callId, new Set());
  sseClients.get(callId).add(res);

  req.on('close', () => {
    sseClients.get(callId)?.delete(res);
    if (sseClients.get(callId)?.size === 0) sseClients.delete(callId);
  });
});

function emitSSE(callId, data) {
  const clients = sseClients.get(callId);
  if (!clients) return;
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(msg); } catch(e) {}
  }
}

// --- HTTP Server + WebSocket ---
const httpServer = createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Track active conversations
const conversations = new Map();

// Handle WebSocket upgrade
httpServer.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const match = url.pathname.match(/^\/llm-websocket\/(.+)$/);
  if (!match) { socket.destroy(); return; }

  const callId = match[1];
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, callId);
  });
});

// --- WebSocket Connection Handler ---
wss.on('connection', (ws, callId) => {
  console.log(`\n[CALL ${callId}] Connected`);

  // STATE: maintains full Claude message history including tool calls/results
  conversations.set(callId, {
    claudeMessages: [], // Full Claude API message history
    callDetails: null,
    propertyContext: null,
  });

  // Send config
  ws.send(JSON.stringify({ response_type: 'config', config: { auto_reconnect: true, call_details: true } }));

  ws.on('message', async (data) => {
    let event;
    try { event = JSON.parse(data.toString()); }
    catch (e) { return; }

    const state = conversations.get(callId);
    if (!state) return;

    try {
      switch (event.interaction_type) {
        case 'call_details':
          state.callDetails = event.call;
          console.log(`[CALL ${callId}] Call started — sending greeting`);
          const greeting = "Hi, thanks for calling Mynd Maintenance. Can I get your name and property address?";
          // Record greeting in Claude message history
          state.claudeMessages.push({ role: 'assistant', content: greeting });
          ws.send(JSON.stringify({ response_id: 0, content: greeting, content_complete: true }));
          break;

        case 'ping_pong':
          ws.send(JSON.stringify({ response_type: 'ping_pong', timestamp: event.timestamp }));
          break;

        case 'update_only':
          break;

        case 'response_required':
          await handleResponse(ws, callId, state, event);
          break;

        case 'reminder_required':
          ws.send(JSON.stringify({
            response_id: event.response_id,
            content: "Are you still there? Take your time.",
            content_complete: true,
          }));
          break;
      }
    } catch (error) {
      console.error(`[CALL ${callId}] Error:`, error.message);
      ws.send(JSON.stringify({
        response_id: event.response_id,
        content: "Sorry, let me try that again. Could you repeat what you said?",
        content_complete: true,
      }));
    }
  });

  ws.on('close', () => {
    console.log(`[CALL ${callId}] Disconnected`);
    conversations.delete(callId);
  });
});

// --- Core Handler ---
async function handleResponse(ws, callId, state, event) {
  // Extract the latest user message from Retell's transcript
  const userMessage = extractLatestUserMessage(event.transcript);
  if (!userMessage) return;

  // Add user message to our persistent Claude history
  state.claudeMessages.push({ role: 'user', content: userMessage });

  console.log(`[CALL ${callId}] User: "${userMessage}"`);
  const startTime = Date.now();

  // Call Claude with full conversation history
  await callClaudeAndRespond(ws, callId, state, event.response_id, startTime);
}

async function callClaudeAndRespond(ws, callId, state, responseId, startTime) {
  let response;
  try {
    response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 400,
      system: systemPrompt,
      tools: tools,
      messages: state.claudeMessages,
    });
  } catch (error) {
    console.error(`[CALL ${callId}] Claude error:`, error.message);
    ws.send(JSON.stringify({
      response_id: responseId,
      content: "One moment, let me try that again.",
      content_complete: true,
    }));
    return;
  }

  const elapsed = Date.now() - startTime;
  console.log(`[CALL ${callId}] Claude ${elapsed}ms, stop=${response.stop_reason}`);
  emitSSE(callId, { type: 'latency', ms: elapsed });

  // Collect text and tool_use blocks
  let textParts = [];
  let toolUseBlocks = [];

  for (const block of response.content) {
    if (block.type === 'text' && block.text.trim()) {
      textParts.push(block.text);
    } else if (block.type === 'tool_use') {
      toolUseBlocks.push(block);
    }
  }

  // LATENCY OPTIMIZATION: If Claude returned text + tool_use, send text immediately
  // so the user hears something while we execute the tool
  if (textParts.length > 0 && toolUseBlocks.length > 0) {
    let spokenText = enforceBrevity(cleanForVoice(textParts.join(' ')));
    if (spokenText) {
      console.log(`[CALL ${callId}] Speaking (while tools execute): "${spokenText.substring(0, 80)}..."`);
      ws.send(JSON.stringify({ response_id: responseId, content: spokenText, content_complete: false }));
    }
  }

  // Record assistant response in history
  state.claudeMessages.push({ role: 'assistant', content: response.content });

  // Execute any tool calls
  if (toolUseBlocks.length > 0) {
    const toolResults = [];

    for (const block of toolUseBlocks) {
      const handler = toolHandlers[block.name];
      if (!handler) {
        console.error(`[CALL ${callId}] Unknown tool: ${block.name}`);
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: 'Tool not found', is_error: true });
        continue;
      }

      const toolInput = block.input || {};
      console.log(`[CALL ${callId}] Tool: ${block.name}(${JSON.stringify(toolInput).substring(0, 100)})`);

      try {
        const result = handler(toolInput);

        // Cache property context
        if (block.name === 'lookup_property') state.propertyContext = result;

        // Flag the call for end-after-next-response when a routing tool says so
        if (result && result.end_call) {
          state.endCallAfterNext = true;
          emitSSE(callId, { type: 'routing', reason: result.reason, department: result.department });
        }

        // Emit tool result to browser UI
        emitSSE(callId, { type: 'tool_result', tool: block.name, result: result });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      } catch (err) {
        console.error(`[CALL ${callId}] Tool ${block.name} error:`, err.message);
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${err.message}`, is_error: true });
      }
    }

    // Add tool results to history
    state.claudeMessages.push({ role: 'user', content: toolResults });

    // Get Claude's follow-up after tool results — recursive to handle chained tool calls
    await callClaudeAndRespond(ws, callId, state, responseId, startTime);
    return;
  }

  // No tool calls — just text. Send it (or finalize if already sent partial).
  if (textParts.length > 0) {
    let finalText = enforceBrevity(cleanForVoice(textParts.join(' ')));
    if (!finalText) return; // Post-processing removed everything — skip
    console.log(`[CALL ${callId}] Response (${Date.now() - startTime}ms): "${finalText.substring(0, 80)}..."`);
    const payload = { response_id: responseId, content: finalText, content_complete: true };
    if (state.endCallAfterNext) {
      payload.end_call = true;
      console.log(`[CALL ${callId}] Ending call after this response (routing)`);
    }
    ws.send(JSON.stringify(payload));

    // Detect priority from Claude's response text and emit to UI
    const lower = finalText.toLowerCase();
    if (lower.includes('emergency') || lower.includes('urgent') || lower.includes('fast-track')) {
      emitSSE(callId, { type: 'priority', level: 'Emergency', scheduling: 'Same-day / next-day' });
    } else if (lower.includes('today or') || lower.includes('first thing tomorrow')) {
      emitSSE(callId, { type: 'priority', level: 'Urgent', scheduling: 'Next-day' });
    } else if (lower.includes('technician') || lower.includes('schedule') || lower.includes('morning') || lower.includes('afternoon')) {
      emitSSE(callId, { type: 'priority', level: 'Standard', scheduling: '2+ days out' });
    }
  }
}

// --- Extract latest user message from Retell transcript ---
function extractLatestUserMessage(transcript) {
  if (!transcript || transcript.length === 0) return null;

  // Find the last user entry in the transcript
  for (let i = transcript.length - 1; i >= 0; i--) {
    if (transcript[i].role === 'user' && transcript[i].content?.trim()) {
      return transcript[i].content.trim();
    }
  }
  return null;
}

// --- Start Server ---
// Only auto-listen when run directly (node src/server.js). When imported by
// tests, the test harness creates its own ephemeral listener.
if (require.main === module) {
  httpServer.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════════════════╗
║   Maintenance Voice Demo — Custom LLM Server       ║
╠════════════════════════════════════════════════════╣
║   WebSocket: ws://localhost:${PORT}/llm-websocket/:id  ║
║   Health:    http://localhost:${PORT}/health            ║
║   Model:     ${CLAUDE_MODEL}            ║
║   Tools:     ${tools.length} registered                           ║
╚════════════════════════════════════════════════════╝
    `);
  });
}

module.exports = { app, httpServer };
