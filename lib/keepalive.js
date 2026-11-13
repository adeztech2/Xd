// HTTP server and keep-alive. isConnected() tells the status page whether the bot is online.
const http = require('http');
const config = require('../config');

function startKeepAlive(isConnected) {
  // Render's free web services sleep after 15 minutes without inbound traffic.
  // This server answers requests, and the bot pings its own public URL so Render sees traffic.
  const KEEP_ALIVE_MS = 10 * 60 * 1000;
  const PUBLIC_URL = (process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
  let keepAliveFailures = 0;

  if (process.env.PORT) {
    http
      .createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(`${config.botName} is running. Connected: ${isConnected() ? 'yes' : 'no'}`);
      })
      .listen(process.env.PORT, () => console.log(`HTTP server on port ${process.env.PORT}`));

    if (PUBLIC_URL) {
      console.log(`Keep-alive: pinging ${PUBLIC_URL} every ${KEEP_ALIVE_MS / 60000} minutes`);
      setInterval(async () => {
        try {
          const res = await fetch(`${PUBLIC_URL}/health`, { signal: AbortSignal.timeout(20000) });
          if (res.ok) {
            keepAliveFailures = 0;
          } else {
            keepAliveFailures += 1;
            console.warn(`Keep-alive: HTTP ${res.status} (${keepAliveFailures} in a row)`);
          }
        } catch (e) {
          keepAliveFailures += 1;
          console.warn(`Keep-alive failed (${keepAliveFailures} in a row): ${e.message}`);
        }
      }, KEEP_ALIVE_MS).unref();
    } else {
      console.warn('Keep-alive is off. Set KEEP_ALIVE_URL to your service URL, or the free web service will sleep.');
    }
  }

}

module.exports = { startKeepAlive };
