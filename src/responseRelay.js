const { getClientByPageId } = require('./config');

const GRAPH_API_VERSION = 'v21.0';

function ts() {
  return new Date().toISOString();
}

async function sendMessage({ pageId, senderPsid, text }) {
  const client = getClientByPageId(pageId);
  if (!client || !client.pageToken) {
    console.error(`[${ts()}] [responseRelay] No page token for pageId=${pageId}`);
    return;
  }

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/me/messages?access_token=${encodeURIComponent(client.pageToken)}`;
  const body = {
    recipient: { id: senderPsid },
    message: { text },
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error(`[${ts()}] [${client.clientName}] [PSID:${senderPsid}] Graph API send failed (${res.status}): ${errText}`);
      return;
    }
    console.log(`[${ts()}] [${client.clientName}] [PSID:${senderPsid}] Response sent to Facebook`);
  } catch (err) {
    console.error(`[${ts()}] [${client.clientName}] [PSID:${senderPsid}] Graph API send error: ${err.message}`);
  }
}

module.exports = { sendMessage };
