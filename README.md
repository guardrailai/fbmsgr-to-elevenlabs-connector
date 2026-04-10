# fbmsgr-elevenlabs-middleware

Middleware bridging Facebook Messenger webhooks to ElevenLabs Conversational AI agents (text-only Chat Mode over WebSocket). One Facebook App fans out to N client Pages, each mapped to a dedicated ElevenLabs agent.

## Architecture

```
Facebook Page --> POST /webhook --> Session Manager --> ElevenLabs WS (text_only)
                                           |                     |
                                           |<-- agent_response --+
                                           v
                                    Graph API send --> Facebook user
```

- **server.js** — Express app + webhook routes + HMAC signature validation
- **sessionManager.js** — WebSocket session pool keyed by `${pageId}_${psid}`, 30-min idle timeout
- **responseRelay.js** — Posts agent responses back via Graph API `v21.0`
- **config.js** — Loads client map (Page ID → agent ID + page token)

In-memory session store (Map). Redis could replace it if persistence across restarts is needed.

## Setup

1. `npm install`
2. Copy `.env.example` → `.env` and fill values
3. Edit `config.json` with real Page IDs and ElevenLabs agent IDs
4. `npm start`

## Environment variables

| Var | Purpose |
|---|---|
| `PORT` | Server port (default 3000) |
| `VERIFY_TOKEN` | String you also paste into Meta webhook config |
| `APP_SECRET` | Facebook App secret (HMAC validation) |
| `ELEVENLABS_API_KEY` | ElevenLabs API key |
| `CLIENT_CONFIG` | Path to config JSON, or inline JSON. Default `./config.json` |
| `PAGE_TOKEN_1..N` | Per-client Facebook Page Access Tokens (names referenced from `config.json`) |

## Client config format

`config.json`:

```json
{
  "PAGE_ID_1": {
    "agentId": "elevenlabs-agent-id-1",
    "pageTokenEnv": "PAGE_TOKEN_1",
    "clientName": "Business1"
  }
}
```

Add a new client by appending one entry and setting the corresponding env var.

## Deployment on Railway

1. Push this repo to GitHub
2. Create a new Railway project from the repo
3. Set env vars in Railway dashboard (do NOT commit `.env`)
4. Railway runs `npm start` automatically and exposes an HTTPS URL
5. In the Meta Developer portal, set the webhook URL to `https://<railway-url>/webhook` and use the same `VERIFY_TOKEN`
6. Subscribe each Page to `messages` events

## Message flow (log trail)

```
[webhook] Received message pageId=... psid=...
[Business1] [PSID:...] New session opened
[Business1] [PSID:...] ElevenLabs WS opened
[Business1] [PSID:...] Session ready
[Business1] [PSID:...] Agent response received
[Business1] [PSID:...] Response sent to Facebook
```

## Notes

- Only text messages are forwarded. Attachments, reactions, read/delivery receipts, and echoes are ignored.
- Sessions idle-timeout after 30 minutes; the next message transparently opens a fresh one.
- HTTP 200 is returned to Facebook immediately; all processing is async.
