/**
 * Retell Agent Setup Script
 *
 * Run this ONCE to:
 *   1. Create a voice agent pointing to your Custom LLM WebSocket
 *   2. Provision a phone number
 *   3. Link the phone number to the agent
 *
 * Prerequisites:
 *   - RETELL_API_KEY in .env
 *   - ngrok running and forwarding to your local server
 *
 * Usage:
 *   node src/agent-config.js <ngrok-url>
 *
 * Example:
 *   node src/agent-config.js wss://abc123.ngrok-free.app
 */

require('dotenv').config();
const Retell = require('retell-sdk').default;

const client = new Retell({
  apiKey: process.env.RETELL_API_KEY,
});

async function setup() {
  const ngrokUrl = process.argv[2];

  if (!ngrokUrl) {
    console.error(`
Usage: node src/agent-config.js <ngrok-wss-url>

Steps:
  1. Start the server:     node src/server.js
  2. Start ngrok:          ngrok http 8080
  3. Copy the https URL from ngrok (e.g., https://abc123.ngrok-free.app)
  4. Run this script:      node src/agent-config.js wss://abc123.ngrok-free.app

Note: Replace 'https://' with 'wss://' in the ngrok URL.
    `);
    process.exit(1);
  }

  // Ensure wss:// prefix
  const wsUrl = ngrokUrl.replace(/^https?:\/\//, 'wss://');
  const llmWebsocketUrl = `${wsUrl}/llm-websocket`;

  console.log(`\nSetting up Retell agent...`);
  console.log(`LLM WebSocket URL: ${llmWebsocketUrl}\n`);

  try {
    // Step 1: Create the voice agent
    console.log('1. Creating voice agent...');
    const agent = await client.agent.create({
      agent_name: 'Mynd Maintenance Voice Bot (PoC)',
      response_engine: {
        type: 'custom-llm',
        llm_websocket_url: llmWebsocketUrl,
      },
      voice_id: '11labs-Adrian', // Professional male voice — change as needed
      voice_temperature: 0.7,
      voice_speed: 1.0,
      responsiveness: 0.8, // Higher = more responsive to interruptions
      interruption_sensitivity: 0.7, // Balanced — allows barge-in but not too sensitive
      enable_backchannel: true, // "mm-hmm", "uh-huh" during resident speech
      backchannel_frequency: 0.6,
      reminder_trigger_ms: 8000, // Prompt if resident is silent for 8s
      reminder_max_count: 2,
      ambient_sound: null, // Clean line, no background noise
      language: 'en-US',
      opt_out_sensitive_data_storage: false, // Enable for HIPAA in production
      end_call_after_silence_ms: 30000, // End call after 30s of silence
    });

    console.log(`   Agent created: ${agent.agent_id}`);
    console.log(`   Name: ${agent.agent_name}`);

    // Step 2: Provision a phone number
    console.log('\n2. Provisioning phone number...');
    const phoneNumber = await client.phoneNumber.create({
      area_code: 480, // Phoenix area code to match mock property data
    });

    console.log(`   Phone number: ${phoneNumber.phone_number}`);
    console.log(`   Phone number ID: ${phoneNumber.phone_number_id}`);

    // Step 3: Link phone number to agent
    console.log('\n3. Linking phone number to agent...');
    await client.phoneNumber.update(phoneNumber.phone_number_id, {
      inbound_agent_id: agent.agent_id,
    });

    console.log('   Linked successfully!');

    // Summary
    console.log(`
╔═══════════════════════════════════════════════════╗
║            SETUP COMPLETE!                         ║
╠═══════════════════════════════════════════════════╣
║                                                   ║
║   Agent ID:     ${agent.agent_id}      ║
║   Phone Number: ${phoneNumber.phone_number}               ║
║                                                   ║
║   Call ${phoneNumber.phone_number} to test!          ║
║                                                   ║
║   Make sure your server is running:               ║
║     node src/server.js                            ║
║                                                   ║
║   And ngrok is forwarding:                        ║
║     ngrok http 8080                               ║
║                                                   ║
╚═══════════════════════════════════════════════════╝
    `);

    // Save config for reference
    const config = {
      agent_id: agent.agent_id,
      phone_number: phoneNumber.phone_number,
      phone_number_id: phoneNumber.phone_number_id,
      llm_websocket_url: llmWebsocketUrl,
      created_at: new Date().toISOString(),
    };

    const fs = require('fs');
    fs.writeFileSync(
      require('path').join(__dirname, '..', 'retell-config.json'),
      JSON.stringify(config, null, 2)
    );
    console.log('Config saved to retell-config.json\n');

  } catch (error) {
    console.error('\nSetup failed:', error.message);
    if (error.status === 401) {
      console.error('Check your RETELL_API_KEY in .env');
    }
    if (error.status === 402) {
      console.error('Retell account needs credits — add payment method at retellai.com');
    }
    process.exit(1);
  }
}

setup();
