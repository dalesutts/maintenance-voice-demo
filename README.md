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

1. **Greet + Identify** — Collects name and address, looks up property
2. **Issue Description** — Open-ended collection of the maintenance problem
3. **Classify + Emergency** — Parallel taxonomy classification and emergency detection
4. **Troubleshooting** — Brief, contextual (1 question max)
5. **Availability** — Emergency: same-day/next-day. Standard: 2+ days, morning/afternoon windows
6. **Photo Request** — SMS with upload link (also masks processing latency)
7. **SR Creation** — Automatic, no resident confirmation needed
8. **Summary + Close**

## Tools

| Tool | Purpose |
|------|---------|
| `lookup_property` | Retrieve property/resident context |
| `classify_and_evaluate` | Taxonomy + emergency detection (parallel) |
| `collect_availability` | Priority-aware scheduling |
| `create_service_request` | Mock SR creation |
| `send_photo_sms` | Text photo upload link |

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
