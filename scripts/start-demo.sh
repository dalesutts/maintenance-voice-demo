#!/bin/bash
# Start the Maintenance Voice Demo
# Usage: npm run demo
# Starts: server + cloudflare tunnel + updates Retell agent

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Load env
source <(grep -v '^#' .env | sed 's/^/export /')

AGENT_ID="${RETELL_AGENT_ID:-agent_0a7ee7f02dae7c885969646a5a}"
CF_LOG="/tmp/cf-tunnel.log"
SERVER_LOG="/tmp/voice-server.log"

echo "==================================="
echo "  Mynd Maintenance Voice Demo"
echo "==================================="
echo ""

# Kill any previous instances
echo "[1/4] Cleaning up old processes..."
taskkill //F //IM cloudflared.exe 2>/dev/null || true
# Kill node on port 8080
for pid in $(netstat -ano 2>/dev/null | grep ":8080" | grep LISTEN | awk '{print $5}' | sort -u); do
  taskkill //F //PID $pid 2>/dev/null || true
done
sleep 1

# Start server
echo "[2/4] Starting server..."
node src/server.js > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!
sleep 2

if ! curl -s http://localhost:8080/health > /dev/null 2>&1; then
  echo "ERROR: Server failed to start. Check $SERVER_LOG"
  exit 1
fi
echo "       Server running (PID $SERVER_PID)"

# Start cloudflare tunnel
echo "[3/4] Starting Cloudflare tunnel..."
"/c/Program Files (x86)/cloudflared/cloudflared.exe" tunnel --url http://localhost:8080 > "$CF_LOG" 2>&1 &
CF_PID=$!
sleep 6

CF_URL=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$CF_LOG" | head -1)
if [ -z "$CF_URL" ]; then
  echo "ERROR: Tunnel failed to start. Check $CF_LOG"
  exit 1
fi
echo "       Tunnel: $CF_URL"

# Update Retell agent
echo "[4/4] Updating Retell agent..."
WS_URL="wss://$(echo $CF_URL | sed 's|https://||')/llm-websocket"
node -e "
require('dotenv').config({ path: require('path').join('$PROJECT_DIR', '.env') });
const Retell = require('retell-sdk').default;
const client = new Retell({ apiKey: process.env.RETELL_API_KEY });
(async () => {
  await client.agent.update('$AGENT_ID', {
    response_engine: { type: 'custom-llm', llm_websocket_url: '$WS_URL' }
  });
  console.log('       Agent updated: $WS_URL');
})();
" 2>&1 | grep -v inject

echo ""
echo "==================================="
echo "  DEMO READY"
echo "==================================="
echo ""
echo "  Open: http://localhost:8080"
echo "  Tunnel: $CF_URL"
echo "  Agent: $AGENT_ID"
echo ""
echo "  Server log: tail -f $SERVER_LOG"
echo "  Tunnel log: tail -f $CF_LOG"
echo ""
echo "  Press Ctrl+C to stop"
echo ""

# Wait for Ctrl+C, then cleanup
trap "echo ''; echo 'Shutting down...'; kill $SERVER_PID $CF_PID 2>/dev/null; exit 0" INT TERM
wait
