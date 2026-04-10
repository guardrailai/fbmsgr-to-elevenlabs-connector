const fs = require('fs');
const path = require('path');

function loadClientConfig() {
  const raw = process.env.CLIENT_CONFIG || './config.json';
  let parsed;
  // Try inline JSON first
  if (raw.trim().startsWith('{')) {
    parsed = JSON.parse(raw);
  } else {
    const filePath = path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  }

  // Resolve page tokens from env vars (pageTokenEnv) or inline pageToken
  const resolved = {};
  for (const [pageId, entry] of Object.entries(parsed)) {
    const pageToken = entry.pageToken || (entry.pageTokenEnv ? process.env[entry.pageTokenEnv] : undefined);
    if (!pageToken) {
      console.warn(`[config] Missing page token for page ${pageId} (${entry.clientName || 'unknown'})`);
    }
    resolved[pageId] = {
      agentId: entry.agentId,
      pageToken,
      clientName: entry.clientName || pageId,
    };
  }
  return resolved;
}

const clientConfig = loadClientConfig();

module.exports = {
  clientConfig,
  getClientByPageId(pageId) {
    return clientConfig[pageId];
  },
  env: {
    PORT: parseInt(process.env.PORT || '3000', 10),
    VERIFY_TOKEN: process.env.VERIFY_TOKEN,
    APP_SECRET: process.env.APP_SECRET,
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
  },
};
