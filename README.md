# Maintenance Voice Demo

Voice AI proof of concept for ResBot Maintenance v2 — residents call a phone number to report maintenance issues via voice conversation.

## Architecture

```
Resident calls phone number → Retell AI (STT/TTS/turn-taking) → Custom LLM WebSocket → Claude (tool calling) → Mock SR creation
```

**Stack:** Retell AI + Claude (Anthropic) + Express/WebSocket + Node.js

## Quick Start

### Prerequisites
- Node.js 18+
- [ngrok](https://ngrok.com/) installed
- Retell AI account ([retellai.com](https://retellai.com))
- Anthropic API key

### Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your API keys
   ```

3. **Start the server:**
   ```bash
   npm start
   ```

4. **Start ngrok (in a separate terminal):**
   ```bash
   ngrok http 8080
   ```

5. **Create the Retell agent + phone number (one-time):**
   ```bash
   node src/agent-config.js wss://YOUR-NGROK-URL.ngrok-free.app
   ```

6. **Call the provisioned phone number!**

### Development

Use `npm run dev` for auto-restart on file changes:
```bash
npm run dev
```

## Conversation Flow

0. **Triage** — Branch on caller intent before verifying identity:
   - *Status update on existing SR* → offer operator transfer, then end call.
   - *Non-maintenance property-management question* (rent, lease, renewal, move-in/out, HOA) → offer transfer to the right department, then end call.
   - *Not property management at all* → politely decline, end call.
   - *Maintenance* → continue below.
1. **Greet + Identify** — Collects name and address, looks up property
2. **Issue Description** — Open-ended collection of the maintenance problem
3. **Classify + Emergency** — Taxonomy classification + Claude-driven emergency detection using property context signals
4. **Troubleshooting** — Brief, contextual (1 question max)
5. **Availability** — Emergency: same-day/next-day. Standard: 2+ days, morning/afternoon windows
6. **Photo Request** — SMS with upload link (also masks processing latency)
7. **SR Creation** — Automatic, no resident confirmation needed
8. **Summary + Close**

## Tools

| Tool | Purpose |
|------|---------|
| `lookup_property` | Retrieve property/resident context |
| `classify_and_evaluate` | Taxonomy classification + property signals for emergency decision |
| `collect_availability` | Priority-aware scheduling (emergency → today/tomorrow; standard → 2+ days) |
| `create_service_request` | Mock SR creation |
| `send_photo_sms` | Text photo upload link |
| `route_and_end_call` | Transfer caller to another team (operator for status updates, other PM department, or polite decline for out-of-scope) and hang up after Claude's goodbye line |

## Taxonomy Coverage

Classification covers Mynd's full production taxonomy: 15 categories, 70+ items, 37 symptoms. Voice-language synonyms are ordered most-specific-first for items and severity-first for symptoms — see the header in `src/tools/classify-and-evaluate.js` and the regression suite in `tests/classify-varied.test.js` before editing.

## Call Routing

The server honors `end_call: true` returned from any tool result by attaching it to the next Retell WebSocket message, which causes Retell to speak the final line and then hang up. Currently only `route_and_end_call` uses this path. A `routing` SSE event is also emitted for the UI panel.

## Latency Targets

| Metric | Target |
|--------|--------|
| End-to-end response | <800ms |
| Dead air | <1.5s |
| Perceived latency | Near-zero (streaming TTS + acknowledgments) |

## Mock Data

Mock data in `src/mocks/` simulates real Mynd data structures:
- `properties.json` — Property details, appliances, ambient conditions
- `taxonomy.json` — Category/item/symptom/location/component hierarchy
- `emergency-rules.json` — Emergency keywords, conditional rules, priority levels
