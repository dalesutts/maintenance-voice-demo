/**
 * Latency analysis for the voice intake pipeline.
 * Measures each step of the conversation to identify bottlenecks.
 *
 * Requires LLM_API_KEY in .env. Run with: npx jest tests/latency.test.js --verbose
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const Anthropic = require('@anthropic-ai/sdk').default;
const fs = require('fs');

const { lookupProperty } = require('../src/tools/lookup-property');
const { classifyAndEvaluate } = require('../src/tools/classify-and-evaluate');
const { collectAvailability } = require('../src/tools/collect-availability');
const { createServiceRequest } = require('../src/tools/create-sr');
const { sendPhotoSms } = require('../src/tools/send-photo-sms');

const { lookupPropertyTool } = require('../src/tools/lookup-property');
const { classifyAndEvaluateTool } = require('../src/tools/classify-and-evaluate');
const { collectAvailabilityTool } = require('../src/tools/collect-availability');
const { createServiceRequestTool } = require('../src/tools/create-sr');
const { sendPhotoSmsTool } = require('../src/tools/send-photo-sms');

const SKIP = !process.env.LLM_API_KEY || process.env.SKIP_LLM_TESTS === '1';
const describeIfLLM = SKIP ? describe.skip : describe;

const anthropic = SKIP ? null : new Anthropic({ apiKey: process.env.LLM_API_KEY });
const systemPrompt = fs.readFileSync(path.join(__dirname, '..', 'src', 'prompts', 'system-prompt.md'), 'utf-8');
const tools = [lookupPropertyTool, classifyAndEvaluateTool, collectAvailabilityTool, createServiceRequestTool, sendPhotoSmsTool];

const toolHandlers = {
  lookup_property: lookupProperty,
  classify_and_evaluate: classifyAndEvaluate,
  collect_availability: collectAvailability,
  create_service_request: createServiceRequest,
  send_photo_sms: sendPhotoSms,
};

// Timing helper
function time(label) {
  const start = performance.now();
  return {
    stop: () => {
      const elapsed = Math.round(performance.now() - start);
      return { label, ms: elapsed };
    }
  };
}

// Simulate one turn: send messages to Claude, execute any tools, get final response
async function simulateTurn(messages, turnLabel) {
  const measurements = [];

  const t1 = time(`${turnLabel}: Claude API call #1`);
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    system: systemPrompt,
    tools,
    messages,
  });
  measurements.push(t1.stop());

  let currentMessages = [...messages];
  let currentResponse = response;
  let callNum = 1;

  // Process tool chains
  while (currentResponse.stop_reason === 'tool_use') {
    // Record assistant response
    currentMessages.push({ role: 'assistant', content: currentResponse.content });

    // Execute all tool calls
    const toolResults = [];
    for (const block of currentResponse.content) {
      if (block.type === 'tool_use') {
        const handler = toolHandlers[block.name];
        if (handler) {
          const tTool = time(`${turnLabel}: Tool ${block.name}`);
          const result = handler(block.input || {});
          measurements.push(tTool.stop());
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
        }
      }
    }

    currentMessages.push({ role: 'user', content: toolResults });

    // Follow-up Claude call
    callNum++;
    const tN = time(`${turnLabel}: Claude API call #${callNum}`);
    currentResponse = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: systemPrompt,
      tools,
      messages: currentMessages,
    });
    measurements.push(tN.stop());
  }

  // Extract final text
  const finalText = currentResponse.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join(' ');

  const totalMs = measurements.reduce((sum, m) => sum + m.ms, 0);
  measurements.push({ label: `${turnLabel}: TOTAL`, ms: totalMs });

  return { measurements, finalText, messages: currentMessages, lastResponse: currentResponse };
}

describeIfLLM('Latency Analysis — Full Intake Flow', () => {
  const allMeasurements = [];

  test('Turn 1: Resident identifies themselves → property lookup', async () => {
    const messages = [
      { role: 'assistant', content: "Hi, thanks for calling Mynd Maintenance. Can I get your name and property address?" },
      { role: 'user', content: "Hi, I'm Sarah Johnson at 1247 Oak Valley Drive." },
    ];

    const result = await simulateTurn(messages, 'T1 (identify)');
    allMeasurements.push(...result.measurements);
    result.measurements.forEach(m => console.log(`  ${m.label}: ${m.ms}ms`));
    expect(result.finalText).toBeTruthy();
  }, 30000);

  test('Turn 2: Resident describes issue', async () => {
    // Build on prior context
    const propertyResult = lookupProperty({ resident_name: 'Sarah Johnson', property_address: '1247 Oak Valley' });
    const messages = [
      { role: 'assistant', content: "Hi, thanks for calling Mynd Maintenance. Can I get your name and property address?" },
      { role: 'user', content: "Hi, I'm Sarah Johnson at 1247 Oak Valley Drive." },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'lookup_property', input: { resident_name: 'Sarah Johnson', property_address: '1247 Oak Valley Drive' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: JSON.stringify(propertyResult) }] },
      { role: 'assistant', content: "Got it, I have that property. What maintenance issue are you experiencing?" },
      { role: 'user', content: "My kitchen faucet is dripping from the base." },
    ];

    const result = await simulateTurn(messages, 'T2 (describe)');
    allMeasurements.push(...result.measurements);
    result.measurements.forEach(m => console.log(`  ${m.label}: ${m.ms}ms`));
    expect(result.finalText).toBeTruthy();
  }, 30000);

  test('Turn 3: Resident clarifies severity → classification', async () => {
    const propertyResult = lookupProperty({ resident_name: 'Sarah Johnson', property_address: '1247 Oak Valley' });
    const messages = [
      { role: 'assistant', content: "Hi, thanks for calling Mynd Maintenance. Can I get your name and property address?" },
      { role: 'user', content: "Sarah Johnson, 1247 Oak Valley Drive." },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'lookup_property', input: { resident_name: 'Sarah Johnson', property_address: '1247 Oak Valley Drive' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: JSON.stringify(propertyResult) }] },
      { role: 'assistant', content: "Got it, I have that property. What maintenance issue are you experiencing?" },
      { role: 'user', content: "My kitchen faucet is dripping from the base." },
      { role: 'assistant', content: "Is the water draining into the sink or leaking onto the floor or cabinet?" },
      { role: 'user', content: "It's just dripping into the sink basin. No damage." },
    ];

    const result = await simulateTurn(messages, 'T3 (classify)');
    allMeasurements.push(...result.measurements);
    result.measurements.forEach(m => console.log(`  ${m.label}: ${m.ms}ms`));
    expect(result.finalText).toBeTruthy();
  }, 30000);

  test('Turn 4: Availability collection', async () => {
    const propertyResult = lookupProperty({ resident_name: 'Sarah Johnson', property_address: '1247 Oak Valley' });
    const classifyResult = classifyAndEvaluate({ issue_description: 'Kitchen faucet dripping from base into sink', property_context: propertyResult });
    const messages = [
      { role: 'assistant', content: "Hi, thanks for calling Mynd Maintenance. Can I get your name and property address?" },
      { role: 'user', content: "Sarah Johnson, 1247 Oak Valley Drive." },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'lookup_property', input: { resident_name: 'Sarah Johnson', property_address: '1247 Oak Valley Drive' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: JSON.stringify(propertyResult) }] },
      { role: 'assistant', content: "Got it, I have that property. What maintenance issue are you experiencing?" },
      { role: 'user', content: "My kitchen faucet is dripping from the base." },
      { role: 'assistant', content: "Is the water draining into the sink or leaking onto the floor or cabinet?" },
      { role: 'user', content: "Just into the sink. No damage." },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'classify_and_evaluate', input: { issue_description: 'Kitchen faucet dripping from base into sink, no damage', property_context: propertyResult } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: JSON.stringify(classifyResult) }] },
      { role: 'assistant', content: "Let me get a technician scheduled for you. We have openings starting Monday. Morning between 8 and noon, or afternoon 1 to 5?" },
      { role: 'user', content: "Monday morning works." },
    ];

    const result = await simulateTurn(messages, 'T4 (availability)');
    allMeasurements.push(...result.measurements);
    result.measurements.forEach(m => console.log(`  ${m.label}: ${m.ms}ms`));
    expect(result.finalText).toBeTruthy();
  }, 30000);

  test('Turn 5: SR creation + photos + closing', async () => {
    const propertyResult = lookupProperty({ resident_name: 'Sarah Johnson', property_address: '1247 Oak Valley' });
    const classifyResult = classifyAndEvaluate({ issue_description: 'Kitchen faucet dripping from base into sink', property_context: propertyResult });
    const availResult = collectAvailability({ verbal_availability: 'Monday morning', priority: 'Standard' });
    const messages = [
      { role: 'assistant', content: "Hi, thanks for calling Mynd Maintenance. Can I get your name and property address?" },
      { role: 'user', content: "Sarah Johnson, 1247 Oak Valley Drive." },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'lookup_property', input: { resident_name: 'Sarah Johnson', property_address: '1247 Oak Valley Drive' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: JSON.stringify(propertyResult) }] },
      { role: 'assistant', content: "Got it, I have that property. What maintenance issue are you experiencing?" },
      { role: 'user', content: "My kitchen faucet is dripping from the base." },
      { role: 'assistant', content: "Is the water draining into the sink or leaking onto the floor?" },
      { role: 'user', content: "Just into the sink." },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'classify_and_evaluate', input: { issue_description: 'Kitchen faucet dripping from base into sink', property_context: propertyResult } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: JSON.stringify(classifyResult) }] },
      { role: 'assistant', content: "Let me get a technician scheduled. Monday morning 8 to noon work?" },
      { role: 'user', content: "Yes that works." },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't3', name: 'collect_availability', input: { verbal_availability: 'Monday morning', priority: 'Standard' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't3', content: JSON.stringify(availResult) }] },
      { role: 'assistant', content: "Monday morning it is." },
      { role: 'user', content: "Great, thanks." },
    ];

    const result = await simulateTurn(messages, 'T5 (SR+photos)');
    allMeasurements.push(...result.measurements);
    result.measurements.forEach(m => console.log(`  ${m.label}: ${m.ms}ms`));
    expect(result.finalText).toBeTruthy();
  }, 45000);

  // Emergency scenario
  test('Turn E1: Emergency AC — whole home, 98°F', async () => {
    const propertyResult = lookupProperty({ resident_name: 'Sarah Johnson', property_address: '1247 Oak Valley' });
    const messages = [
      { role: 'assistant', content: "Hi, thanks for calling Mynd Maintenance. Can I get your name and property address?" },
      { role: 'user', content: "Sarah Johnson, 1247 Oak Valley Drive." },
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'lookup_property', input: { resident_name: 'Sarah Johnson', property_address: '1247 Oak Valley Drive' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: JSON.stringify(propertyResult) }] },
      { role: 'assistant', content: "Got it, I have that property. What maintenance issue are you experiencing?" },
      { role: 'user', content: "My AC completely stopped working. The whole house is hot, nothing is cooling at all." },
    ];

    const result = await simulateTurn(messages, 'TE1 (emergency AC)');
    allMeasurements.push(...result.measurements);
    result.measurements.forEach(m => console.log(`  ${m.label}: ${m.ms}ms`));
    expect(result.finalText).toBeTruthy();
  }, 30000);

  afterAll(() => {
    // Print summary
    console.log('\n\n====================================');
    console.log('  LATENCY ANALYSIS SUMMARY');
    console.log('====================================\n');

    // Group by turn
    const turns = {};
    const apiCalls = [];
    const toolCalls = [];

    for (const m of allMeasurements) {
      const turnMatch = m.label.match(/^(T\w+)/);
      if (turnMatch) {
        const turn = turnMatch[1];
        if (!turns[turn]) turns[turn] = [];
        turns[turn].push(m);
      }
      if (m.label.includes('Claude API')) apiCalls.push(m.ms);
      if (m.label.includes('Tool ')) toolCalls.push(m.ms);
    }

    for (const [turn, measurements] of Object.entries(turns)) {
      const total = measurements.find(m => m.label.includes('TOTAL'));
      const apis = measurements.filter(m => m.label.includes('Claude API'));
      const tools = measurements.filter(m => m.label.includes('Tool'));
      console.log(`${turn}:`);
      console.log(`  Total: ${total?.ms || '?'}ms`);
      console.log(`  Claude API calls: ${apis.length} (${apis.map(a => a.ms + 'ms').join(' + ')})`);
      console.log(`  Tool calls: ${tools.length} (${tools.map(t => t.label.split('Tool ')[1] + '=' + t.ms + 'ms').join(', ')})`);
      console.log('');
    }

    // Aggregate stats
    if (apiCalls.length > 0) {
      const sorted = [...apiCalls].sort((a, b) => a - b);
      console.log('--- Claude API Call Stats ---');
      console.log(`  Count: ${apiCalls.length}`);
      console.log(`  Min: ${sorted[0]}ms`);
      console.log(`  Max: ${sorted[sorted.length - 1]}ms`);
      console.log(`  Median: ${sorted[Math.floor(sorted.length / 2)]}ms`);
      console.log(`  Mean: ${Math.round(apiCalls.reduce((a, b) => a + b, 0) / apiCalls.length)}ms`);
      console.log(`  p90: ${sorted[Math.floor(sorted.length * 0.9)]}ms`);
      console.log('');
    }

    if (toolCalls.length > 0) {
      console.log('--- Tool Execution Stats ---');
      console.log(`  Count: ${toolCalls.length}`);
      console.log(`  Max: ${Math.max(...toolCalls)}ms`);
      console.log(`  All < 5ms: ${toolCalls.every(t => t < 5) ? 'YES' : 'NO'}`);
      console.log('');
    }

    // Optimization impact estimates
    const avgApi = Math.round(apiCalls.reduce((a, b) => a + b, 0) / apiCalls.length);
    console.log('--- Optimization Impact Estimates ---');
    console.log(`  Current avg Claude API call: ${avgApi}ms`);
    console.log(`  With Cerebras (~100ms):      Saves ~${avgApi - 100}ms per API call`);
    console.log(`  With pre-cached property:    Saves 1 full API round-trip (${avgApi}ms) on Turn 1`);
    console.log(`  With single-shot SR:         Saves ${avgApi * 2}-${avgApi * 3}ms on final turn (2-3 fewer API calls)`);
    console.log(`  With streaming TTS:          Saves ~300-500ms perceived latency per turn`);
    console.log('');
  });
}, 180000);
