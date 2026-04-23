/**
 * Conversation simulation tests.
 * These test the full Claude pipeline with real API calls.
 * They verify that Claude follows the system prompt rules.
 *
 * These tests require LLM_API_KEY in .env and make real API calls.
 * Run with: npm run test:conversation
 * Skip with: SKIP_LLM_TESTS=1 npm test
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const Anthropic = require('@anthropic-ai/sdk').default;
const fs = require('fs');

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

async function getClaudeResponse(messages) {
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    system: systemPrompt,
    tools,
    messages,
  });
  return response;
}

function getTextContent(response) {
  return response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join(' ');
}

function getToolCalls(response) {
  return response.content
    .filter(b => b.type === 'tool_use')
    .map(b => ({ name: b.name, input: b.input }));
}

describeIfLLM('Conversation Rules (LLM)', () => {

  test('calls lookup_property when resident provides name and address', async () => {
    const response = await getClaudeResponse([
      { role: 'assistant', content: "Hi, thanks for calling Mynd Maintenance. Can I get your name and property address?" },
      { role: 'user', content: "I'm Sarah Johnson at 1247 Oak Valley Drive" },
    ]);
    const toolCalls = getToolCalls(response);
    expect(toolCalls.length).toBeGreaterThan(0);
    expect(toolCalls[0].name).toBe('lookup_property');
  }, 15000);

  test('does NOT reveal resident name — only confirms address', async () => {
    const response = await getClaudeResponse([
      { role: 'assistant', content: "Hi, thanks for calling Mynd Maintenance. Can I get your name and property address?" },
      { role: 'user', content: "I'm Sarah Johnson at 1247 Oak Valley Drive" },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tool1', name: 'lookup_property', input: { resident_name: 'Sarah Johnson', property_address: '1247 Oak Valley Drive' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool1', content: JSON.stringify({ found: true, resident_name: 'Sarah Johnson', property: { address: '1247 W Oak Valley Drive', city: 'Phoenix', state: 'AZ' }, unit: { bedrooms: 3, full_bathrooms: 2 }, ambient_conditions: { current_outdoor_temp_f: 98 } }) }] },
    ]);
    const text = getTextContent(response);
    // Should NOT say the resident's name
    expect(text.toLowerCase()).not.toMatch(/sarah johnson/i);
    // Should confirm the property exists (may or may not mention specific address)
    expect(text.toLowerCase()).toMatch(/property|that property|oak valley|got it/i);
  }, 15000);

  test('rejects unverified caller', async () => {
    const response = await getClaudeResponse([
      { role: 'assistant', content: "Hi, thanks for calling Mynd Maintenance. Can I get your name and property address?" },
      { role: 'user', content: "I'm Joe Smith at 999 Fake Street" },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tool1', name: 'lookup_property', input: { resident_name: 'Joe Smith', property_address: '999 Fake Street' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool1', content: JSON.stringify({ found: false, message: 'No account found for "Joe Smith" at "999 Fake Street"' }) }] },
    ]);
    const text = getTextContent(response);
    // Should NOT proceed with intake
    expect(text.toLowerCase()).not.toContain('what maintenance');
    // Should ask to verify
    expect(text.toLowerCase()).toMatch(/not finding|couldn't find|can't find|no account|double.?check|verify/i);
  }, 15000);

  test('never uses internal jargon', async () => {
    const response = await getClaudeResponse([
      { role: 'assistant', content: "Hi, thanks for calling Mynd Maintenance. Can I get your name and property address?" },
      { role: 'user', content: "Sarah Johnson, 1247 Oak Valley Drive" },
      { role: 'assistant', content: "Got it, I have that property. What maintenance issue are you experiencing?" },
      { role: 'user', content: "My kitchen faucet is dripping from the base" },
    ]);
    const text = getTextContent(response).toLowerCase();
    const jargon = ['classify', 'categorize', 'taxonomy', 'triage', 'priority level', 'standard repair', 'standard priority'];
    for (const word of jargon) {
      expect(text).not.toContain(word);
    }
  }, 15000);

  test('does not include special characters (asterisks, bullets)', async () => {
    const response = await getClaudeResponse([
      { role: 'assistant', content: "Got it, I have that property. What maintenance issue are you experiencing?" },
      { role: 'user', content: "My AC stopped working and it's really hot in here" },
    ]);
    const text = getTextContent(response);
    expect(text).not.toContain('*');
    expect(text).not.toContain('•');
    expect(text).not.toContain('- ');
  }, 15000);

  test('asks about whole home vs partial for HVAC', async () => {
    const response = await getClaudeResponse([
      { role: 'assistant', content: "Got it, I have that property. What maintenance issue are you experiencing?" },
      { role: 'user', content: "My AC stopped working" },
    ]);
    const text = getTextContent(response).toLowerCase();
    // Should ask about scope — whole home vs part
    expect(text).toMatch(/whole|entire|all rooms|every room|part of|certain rooms|just one/i);
  }, 15000);

  test('asks about leak severity for plumbing', async () => {
    const response = await getClaudeResponse([
      { role: 'assistant', content: "Got it, I have that property. What maintenance issue are you experiencing?" },
      { role: 'user', content: "My kitchen faucet is leaking" },
    ]);
    const text = getTextContent(response).toLowerCase();
    // Should ask a clarifying question about where/component/severity
    expect(text).toMatch(/where|base|handle|underneath|floor|cabinet|sink|basin|drip|steady/i);
  }, 15000);

  test('accepts vendor-coordinated work (tree on fence) as maintenance', async () => {
    // Regression: bot used to decline tree/fence damage as "not something we handle"
    // because it felt like a specialist job. It's still a maintenance intake.
    const response = await getClaudeResponse([
      { role: 'assistant', content: "Got it, I have that property. What maintenance issue are you experiencing?" },
      { role: 'user', content: "A tree fell in the backyard and broke part of the fence" },
    ]);
    const text = getTextContent(response).toLowerCase();
    const toolCalls = getToolCalls(response);
    // Must NOT route the call out of scope or tell the resident we don't handle this.
    expect(toolCalls.find(t => t.name === 'route_and_end_call')).toBeUndefined();
    expect(text).not.toMatch(/don'?t (handle|do|cover)|can'?t help|not something we/i);
    // Should engage with the issue — ask a clarifying question or classify.
    const engaged = /tree|fence|backyard|where|how big|damage|hurt|anyone/i.test(text)
      || toolCalls.some(t => t.name === 'classify_and_evaluate');
    expect(engaged).toBe(true);
  }, 15000);

}, 60000);

describeIfLLM('Emergency Detection (LLM)', () => {

  test('identifies whole-home AC failure in AZ heat as emergency', async () => {
    const propertyContext = { found: true, property: { state: 'AZ' }, unit: { full_bathrooms: 2 }, ambient_conditions: { current_outdoor_temp_f: 98 } };
    const response = await getClaudeResponse([
      { role: 'assistant', content: "Got it, I have that property. What maintenance issue are you experiencing?" },
      { role: 'user', content: "My AC stopped working completely. The whole house is hot, nothing is cooling." },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tool2', name: 'classify_and_evaluate', input: { issue_description: 'AC stopped working, whole house not cooling', property_context: propertyContext } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool2', content: JSON.stringify({ taxonomy: { category: 'heating and cooling', item: 'air conditioner', symptom: 'not cooling', location: 'whole home' }, property_signals: { outdoor_temp_f: 98, state: 'AZ', bathrooms: 2 } }) }] },
    ]);
    const text = getTextContent(response).toLowerCase();
    // Should treat as emergency — prioritize, mention today/tomorrow
    expect(text).toMatch(/priorit|right away|today|tomorrow|soon as possible|urgent/i);
  }, 15000);

  test('does NOT treat partial AC failure as emergency', async () => {
    const propertyContext = { found: true, property: { state: 'AZ' }, unit: { full_bathrooms: 2 }, ambient_conditions: { current_outdoor_temp_f: 98 } };
    const response = await getClaudeResponse([
      { role: 'assistant', content: "Got it, I have that property. What maintenance issue are you experiencing?" },
      { role: 'user', content: "The AC in the bedroom upstairs isn't cooling but the rest of the house is fine" },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tool2', name: 'classify_and_evaluate', input: { issue_description: 'AC in bedroom not cooling, rest of house fine', property_context: propertyContext } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool2', content: JSON.stringify({ taxonomy: { category: 'heating and cooling', item: 'air conditioner', symptom: 'not cooling', location: 'bedroom' }, property_signals: { outdoor_temp_f: 98, state: 'AZ', bathrooms: 2 } }) }] },
    ]);
    const text = getTextContent(response).toLowerCase();
    // Should NOT treat as emergency — should schedule normally
    expect(text).not.toMatch(/emergency|fast.?track|right away/i);
  }, 15000);

  test('treats gas smell as emergency with safety instruction', async () => {
    const response = await getClaudeResponse([
      { role: 'assistant', content: "Got it, I have that property. What maintenance issue are you experiencing?" },
      { role: 'user', content: "I smell gas in my kitchen" },
    ]);
    const text = getTextContent(response).toLowerCase();
    // Should mention utility company or 911
    expect(text).toMatch(/utility|gas company|911|evacuate|leave/i);
  }, 15000);

  test('minor drip into sink is NOT emergency', async () => {
    const response = await getClaudeResponse([
      { role: 'assistant', content: "So you've got a dripping kitchen faucet. Is the water leaking onto the floor or into the cabinet, or is it draining into the sink?" },
      { role: 'user', content: "It's just dripping into the sink basin. No damage anywhere." },
    ]);
    const text = getTextContent(response).toLowerCase();
    expect(text).not.toMatch(/emergency|urgent|fast.?track|right away|priorit/i);
  }, 15000);

  test('bot never says "emergency" or "not an emergency" to the resident', async () => {
    // Regression: bot was saying "This isn't an emergency situation" — internal jargon leak.
    const response = await getClaudeResponse([
      { role: 'assistant', content: "Got it, I have that property. What maintenance issue are you experiencing?" },
      { role: 'user', content: "A tree fell in the backyard and damaged my fence" },
    ]);
    const text = getTextContent(response).toLowerCase();
    // Must not label the call as emergency/non-emergency either way.
    expect(text).not.toMatch(/\bemergency\b|not an emergency|non.?emergency|priority level/i);
  }, 15000);

  test('dead refrigerator is emergency (food spoilage)', async () => {
    const propertyContext = { found: true, property: { state: 'CA' }, unit: { full_bathrooms: 2 } };
    const response = await getClaudeResponse([
      { role: 'assistant', content: "Got it, I have that property. What maintenance issue are you experiencing?" },
      { role: 'user', content: "My refrigerator completely died last night. Nothing is cold and my food is going bad." },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tool_fridge', name: 'classify_and_evaluate', input: { issue_description: 'Refrigerator dead, not cooling, food spoiling', property_context: propertyContext } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool_fridge', content: JSON.stringify({ taxonomy: { category: 'appliances', item: 'refrigerator', symptom: 'not cooling' }, property_signals: { state: 'CA', bathrooms: 2 } }) }] },
    ]);
    const text = getTextContent(response).toLowerCase();
    expect(text).toMatch(/today|tomorrow|right away|priorit|soon as possible/i);
  }, 15000);

  test('broken entry lock is emergency (safety)', async () => {
    const response = await getClaudeResponse([
      { role: 'assistant', content: "Got it, I have that property. What maintenance issue are you experiencing?" },
      { role: 'user', content: "My front door lock is broken — I can't lock my front door at all, it won't engage." },
    ]);
    const text = getTextContent(response).toLowerCase();
    // Should either treat as emergency OR ask a clarifying question — must NOT route out-of-scope
    const toolCalls = getToolCalls(response);
    expect(toolCalls.find(t => t.name === 'route_and_end_call')).toBeUndefined();
    expect(text).not.toMatch(/don'?t (handle|do|cover)|can'?t help/i);
  }, 15000);

  test('pest infestation is accepted as maintenance (vendor-coordinated)', async () => {
    const response = await getClaudeResponse([
      { role: 'assistant', content: "Got it, I have that property. What maintenance issue are you experiencing?" },
      { role: 'user', content: "I've got rats in the attic, I can hear them at night and found droppings" },
    ]);
    const text = getTextContent(response).toLowerCase();
    const toolCalls = getToolCalls(response);
    // Should NOT decline as "call a pest service yourself"
    expect(toolCalls.find(t => t.name === 'route_and_end_call')).toBeUndefined();
    expect(text).not.toMatch(/don'?t (handle|do|cover)|call (a |an )?(pest|exterminator)|not something we/i);
  }, 15000);

  test('active roof leak during storm escalates severity', async () => {
    const propertyContext = { found: true, property: { state: 'WA' }, unit: { full_bathrooms: 2 }, ambient_conditions: { rainfall_forecast_24h: true } };
    const response = await getClaudeResponse([
      { role: 'assistant', content: "Got it, I have that property. What maintenance issue are you experiencing?" },
      { role: 'user', content: "Water is pouring through my ceiling from the roof. It's storming outside right now and I'm catching it in buckets." },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tool_roof', name: 'classify_and_evaluate', input: { issue_description: 'Water pouring from ceiling, active roof leak, storm outside', property_context: propertyContext } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool_roof', content: JSON.stringify({ taxonomy: { category: 'exterior', item: 'roof', symptom: 'severe leaking' }, property_signals: { state: 'WA', rainfall_forecast_24h: true } }) }] },
    ]);
    const text = getTextContent(response).toLowerCase();
    expect(text).toMatch(/today|tomorrow|right away|priorit|soon as possible/i);
  }, 15000);

  test('cosmetic cabinet issue is NOT emergency', async () => {
    const response = await getClaudeResponse([
      { role: 'assistant', content: "Got it, I have that property. What maintenance issue are you experiencing?" },
      { role: 'user', content: "One of my kitchen cabinet doors has come loose at the hinge — still attached, just wobbly." },
    ]);
    const text = getTextContent(response).toLowerCase();
    expect(text).not.toMatch(/emergency|today|right away/i);
  }, 15000);

  test('status-update call triggers operator transfer flow', async () => {
    const response = await getClaudeResponse([
      { role: 'user', content: "Hi, I put in a maintenance request last week and I'm calling for an update on when the plumber is coming out." },
    ]);
    const text = getTextContent(response).toLowerCase();
    // Should offer operator transfer, not try to look up SR status
    expect(text).toMatch(/operator|transfer|look that up|can'?t pull/i);
  }, 15000);

  test('rent payment question routes to Accounting, not maintenance', async () => {
    const response = await getClaudeResponse([
      { role: 'user', content: "I'm calling because my rent payment didn't go through and I got a late fee I need reversed." },
    ]);
    const text = getTextContent(response).toLowerCase();
    // Should mention accounting or transferring — not start maintenance intake
    expect(text).toMatch(/accounting|billing|transfer|not maintenance|different team|right team/i);
    expect(text).not.toMatch(/what maintenance issue|what'?s going on with the (home|property|unit)/i);
  }, 15000);

}, 60000);
