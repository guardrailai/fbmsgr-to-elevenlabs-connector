const WebSocket = require('ws');
const { getClientByPageId, env } = require('./config');
const { sendMessage } = require('./responseRelay');

// In-memory session store. Key: `${pageId}_${senderPsid}`.
// NOTE: Redis could replace this Map for persistence across restarts if needed in the future.
const sessions = new Map();

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

function ts() {
  return new Date().toISOString();
}

function sessionKey(pageId, senderPsid) {
  return `${pageId}_${senderPsid}`;
}

/**
 * Open a new ElevenLabs Conversational AI WebSocket session in text-only mode.
 * Uses the public WSS endpoint directly (avoids SDK browser-only deps).
 */
function openElevenLabsSocket(agentId) {
  const url = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${encodeURIComponent(agentId)}`;
  return new WebSocket(url, {
    headers: { 'xi-api-key': env.ELEVENLABS_API_KEY },
  });
}

function createSession(pageId, senderPsid) {
  const client = getClientByPageId(pageId);
  if (!client) {
    console.error(`[${ts()}] [sessionManager] Unknown pageId=${pageId}`);
    return null;
  }

  const key = sessionKey(pageId, senderPsid);
  const ws = openElevenLabsSocket(client.agentId);

  const session = {
    key,
    pageId,
    senderPsid,
    clientName: client.clientName,
    ws,
    ready: false,
    pending: [], // messages queued until socket is open + initialized
    timeout: null,
  };

  const resetTimeout = () => {
    if (session.timeout) clearTimeout(session.timeout);
    session.timeout = setTimeout(() => {
      console.log(`[${ts()}] [${client.clientName}] [PSID:${senderPsid}] Session idle timeout — closing`);
      try { ws.close(); } catch (_) {}
      sessions.delete(key);
    }, SESSION_TIMEOUT_MS);
  };
  session.resetTimeout = resetTimeout;
  resetTimeout();

  ws.on('open', () => {
    console.log(`[${ts()}] [${client.clientName}] [PSID:${senderPsid}] ElevenLabs WS opened`);
    // Send conversation initiation with text-only mode
    const initPayload = {
      type: 'conversation_initiation_client_data',
      conversation_config_override: {
        conversation: { text_only: true },
      },
    };
    try {
      ws.send(JSON.stringify(initPayload));
    } catch (err) {
      console.error(`[${ts()}] [${client.clientName}] [PSID:${senderPsid}] Failed to send init: ${err.message}`);
    }
  });

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (err) {
      console.error(`[${ts()}] [${client.clientName}] [PSID:${senderPsid}] Invalid WS JSON: ${err.message}`);
      return;
    }

    try {
      switch (msg.type) {
        case 'conversation_initiation_metadata': {
          session.ready = true;
          console.log(`[${ts()}] [${client.clientName}] [PSID:${senderPsid}] Session ready`);
          // Flush queued messages
          while (session.pending.length > 0) {
            const text = session.pending.shift();
            sendUserMessage(session, text);
          }
          break;
        }
        case 'ping': {
          // Respond to keep-alive pings
          const eventId = msg.ping_event && msg.ping_event.event_id;
          if (eventId != null) {
            ws.send(JSON.stringify({ type: 'pong', event_id: eventId }));
          }
          break;
        }
        case 'agent_response': {
          const text = msg.agent_response_event && msg.agent_response_event.agent_response;
          if (text && text.trim().length > 0) {
            console.log(`[${ts()}] [${client.clientName}] [PSID:${senderPsid}] Agent response received`);
            await sendMessage({ pageId, senderPsid, text });
          }
          break;
        }
        case 'interruption':
        case 'user_transcript':
        case 'agent_response_correction':
        case 'internal_tentative_agent_response':
          // Not relevant for text-only relay
          break;
        default:
          // Unknown/ignored types — log at debug level
          break;
      }
    } catch (err) {
      console.error(`[${ts()}] [${client.clientName}] [PSID:${senderPsid}] Error handling WS message: ${err.message}`);
    }
  });

  ws.on('error', (err) => {
    console.error(`[${ts()}] [${client.clientName}] [PSID:${senderPsid}] WS error: ${err.message}`);
  });

  ws.on('close', (code, reason) => {
    console.log(`[${ts()}] [${client.clientName}] [PSID:${senderPsid}] WS closed (${code}) ${reason || ''}`);
    if (session.timeout) clearTimeout(session.timeout);
    sessions.delete(key);
  });

  sessions.set(key, session);
  return session;
}

function sendUserMessage(session, text) {
  try {
    session.ws.send(JSON.stringify({
      type: 'user_message',
      text,
    }));
  } catch (err) {
    console.error(`[${ts()}] [${session.clientName}] [PSID:${session.senderPsid}] Failed to send user message: ${err.message}`);
  }
}

async function handleIncomingMessage({ pageId, senderPsid, text }) {
  const key = sessionKey(pageId, senderPsid);
  let session = sessions.get(key);

  if (!session) {
    session = createSession(pageId, senderPsid);
    if (!session) return;
    console.log(`[${ts()}] [${session.clientName}] [PSID:${senderPsid}] New session opened`);
  } else {
    console.log(`[${ts()}] [${session.clientName}] [PSID:${senderPsid}] Reusing existing session`);
    session.resetTimeout();
  }

  if (!session.ready || session.ws.readyState !== WebSocket.OPEN) {
    session.pending.push(text);
    return;
  }

  sendUserMessage(session, text);
}

module.exports = { handleIncomingMessage };
