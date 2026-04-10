const express = require('express');
const crypto = require('crypto');
const { env } = require('./config');
const { handleIncomingMessage } = require('./sessionManager');

const app = express();

function ts() {
  return new Date().toISOString();
}

// Capture raw body for HMAC signature validation
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// GET /webhook — Facebook verification handshake
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === env.VERIFY_TOKEN) {
    console.log(`[${ts()}] [webhook] Verification success`);
    return res.status(200).send(challenge);
  }
  console.warn(`[${ts()}] [webhook] Verification failed`);
  return res.sendStatus(403);
});

function verifySignature(req) {
  const sig = req.get('X-Hub-Signature-256');
  if (!sig || !req.rawBody) return false;
  const expected =
    'sha256=' +
    crypto.createHmac('sha256', env.APP_SECRET).update(req.rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  } catch (_) {
    return false;
  }
}

// POST /webhook — Incoming messages
app.post('/webhook', (req, res) => {
  if (!verifySignature(req)) {
    console.warn(`[${ts()}] [webhook] Invalid signature`);
    return res.sendStatus(403);
  }

  // Ack immediately — Facebook requires <5s
  res.sendStatus(200);

  // Process async
  setImmediate(() => {
    try {
      const body = req.body;
      if (body.object !== 'page') return;

      for (const entry of body.entry || []) {
        const pageId = entry.id;
        for (const event of entry.messaging || []) {
          const senderPsid = event.sender && event.sender.id;
          const message = event.message;

          // Filter out non-text / echoes / delivery / read / reactions
          if (!message) continue;
          if (message.is_echo) continue;
          if (!message.text) continue;
          if (message.attachments) continue;

          const text = message.text;
          console.log(`[${ts()}] [webhook] Received message pageId=${pageId} psid=${senderPsid}`);
          Promise.resolve(handleIncomingMessage({ pageId, senderPsid, text })).catch((err) => {
            console.error(`[${ts()}] [webhook] handleIncomingMessage error: ${err.message}`);
          });
        }
      }
    } catch (err) {
      console.error(`[${ts()}] [webhook] Error processing webhook: ${err.message}`);
    }
  });
});

app.get('/', (_req, res) => res.status(200).send('fbmsgr-elevenlabs-middleware OK'));

process.on('unhandledRejection', (reason) => {
  console.error(`[${ts()}] [process] Unhandled rejection: ${reason}`);
});
process.on('uncaughtException', (err) => {
  console.error(`[${ts()}] [process] Uncaught exception: ${err.message}`);
});

app.listen(env.PORT, () => {
  console.log(`[${ts()}] Server listening on port ${env.PORT}`);
});
