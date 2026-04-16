# Architecture

## Request flow

```
Resident call
   │
   ▼
Retell AI  ── STT / streaming TTS / turn-taking ──┐
   │                                              │
   │ Custom LLM WebSocket                         │
   ▼                                              │
Node Express + ws server  (src/server.js)         │
   │                                              │
   │ Claude API (claude-haiku-4-5)                │
   ▼                                              │
Claude tool-calling loop                          │
   │                                              │
   ├── tool → handler → state update ─────────────┤
   │                                              │
   └── text (+ optional end_call) ────────────────┘
```

Latency budget per turn: <800ms end-to-end. Perceived latency is masked by sending Claude's pre-tool text immediately while tool handlers execute in the same response.

## Conversation state

Per-call state lives in `conversations: Map<callId, State>` keyed by Retell's `callId`. Cleared on WebSocket close.

```js
State = {
  claudeMessages: Array,   // full Claude message history (user / assistant / tool_use / tool_result)
  callDetails: Object,     // Retell call metadata
  propertyContext: Object, // cached result of lookup_property
  endCallAfterNext: bool,  // set by any tool returning end_call: true
}
```

## Tool contracts

All tools are synchronous JS functions dispatched by name in `server.js`. They are registered both as Claude tool definitions (for Claude's planner) and as handlers (for execution). Return values are `JSON.stringify`'d back into the Claude message history as `tool_result` blocks.

| Tool | Input | Returns | Side effects |
|------|-------|---------|--------------|
| `lookup_property` | `{ name, address }` | Property context object or `{found: false}` | Caches to `state.propertyContext` |
| `classify_and_evaluate` | `{ issue_description, property_context }` | `{ taxonomy, property_signals, note }` — Claude decides priority | None |
| `collect_availability` | `{ priority, window }` | `{ scheduled_date, scheduled_window, day_of_week }` | None |
| `create_service_request` | `{ ...SR fields }` | `{ sr_id, confirmation }` | None (mock) |
| `send_photo_sms` | `{ phone, issue }` | `{ sent: true, link }` | None (mock) |
| `route_and_end_call` | `{ reason, department?, caller_intent? }` | `{ routed, department, end_call: true, note }` | Sets `state.endCallAfterNext` |

### The `end_call` contract

Any tool handler may return `{ end_call: true, ... }`. When the server sees this flag on a tool result:

1. It sets `state.endCallAfterNext = true`.
2. On the next outbound Retell message that has `content_complete: true`, it attaches `end_call: true`.
3. Retell speaks the final content, then hangs up.

This decouples the termination decision from the transport layer — tools just signal intent, the server handles the protocol detail.

## Call triage (Step 0 in the system prompt)

Before verification, Claude categorizes the caller's intent from their opening statement:

| Intent | Example | Action |
|--------|---------|--------|
| Status update on existing SR | "any update on my work order?" | Confirm → `route_and_end_call({reason: "status_update"})` |
| Non-maintenance PM question | "I want to renew my lease" | Confirm → `route_and_end_call({reason: "other_department", department: "Leasing"})` |
| Out-of-scope | wrong number, sales call | Politely decline → `route_and_end_call({reason: "out_of_scope"})` |
| Maintenance | "my AC is broken" | Proceed to step 1 (verify caller) |
| Ambiguous | one clarifying question, then re-triage |

Department routing map (for `other_department`):
- Rent / payments → Accounting
- Lease / renewal / move-in / move-out → Leasing
- Neighbors / policies / general questions → Resident Services
- Unsure → "the right team"

## Taxonomy classification

`src/tools/classify-and-evaluate.js` produces `category / item / symptom / location` from the resident's description using ordered synonym matching. Two ordering invariants:

1. **Items: most-specific first.** "water heater" must precede "heater". Multi-word composites ("cabinet door", "light switch") must appear in the composite item's synonym list so they beat the generic item.
2. **Symptoms: severity first.** "severe leaking" (pouring, gushing) matches before "leaking". "Flooding" before "leaking". This band drives emergency classification downstream.

Category-keyword fallback fires only when no item matches. Regression coverage: `tests/classify-varied.test.js` (47 assertions across all 15 categories).

## UI event stream

Browser panel (`public/index.html`) subscribes to `/events/:callId?token=…` via SSE. The token is issued by `/create-web-call` and scoped to that callId; subscribing without a valid token returns 403. Tokens expire after 1 hour. Server emits:

| Event type | When | Payload |
|------------|------|---------|
| `tool_result` | After each tool executes | `{ tool, result }` |
| `priority` | Detected from Claude's response text | `{ level, scheduling }` |
| `latency` | After each Claude API call | `{ ms }` |
| `routing` | When a routing tool fires | `{ reason, department }` |

## Security

- **CORS allowlist** (`ALLOWED_ORIGINS` env, comma-separated). Defaults cover localhost + the Render demo host. Disallowed origins are rejected at the middleware layer.
- **Optional `/create-web-call` shared secret** — if `DEMO_SECRET` env is set, requests must send `X-Demo-Secret` matching. Leaving it unset allows any origin on the allowlist to start a call (demo-friendly default).
- **Token-gated SSE** — `/events/:callId?token=…` requires a token issued when the call was created. Prevents anyone who guesses/overhears a callId from tapping the live PII stream.
- **Regression coverage:** `tests/security.test.js`.

## Files

```
src/
├── server.js                      WebSocket + HTTP + SSE + Claude loop
├── post-process.js                Voice-grade text cleaning (jargon, spacing)
├── prompts/system-prompt.md       Agent behavior spec (triage + intake flow)
├── tools/
│   ├── lookup-property.js
│   ├── classify-and-evaluate.js   Taxonomy + synonym matching
│   ├── collect-availability.js
│   ├── create-sr.js
│   ├── send-photo-sms.js
│   └── route-and-end.js           Transfer + hang up
└── mocks/
    ├── properties.json
    ├── taxonomy.json              15 categories, 70+ items, 37 symptoms
    └── emergency-rules.json

tests/
├── classify.test.js               Core taxonomy hits
├── classify-varied.test.js        Full-taxonomy regression coverage
├── conversation.test.js           Live-LLM end-to-end flows
├── route-and-end.test.js          Triage tool
└── latency.test.js                API call timing instrumentation
```
