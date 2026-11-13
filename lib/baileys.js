// Loads Baileys in a way that works for both 6.x (CommonJS) and 7.x (ESM).
// index.js calls loadBaileys() once at startup; everything else calls baileys() afterwards.
let lib = null;

async function loadBaileys() {
  if (lib) return lib;
  const m = await import('@whiskeysockets/baileys');
  const d = m.default;
  const pick = (name) => m[name] ?? (d && d[name]);
  const makeWASocket =
    typeof d === 'function' ? d : (d && typeof d.default === 'function' ? d.default : m.makeWASocket);
  lib = {
    makeWASocket,
    useMultiFileAuthState: pick('useMultiFileAuthState'),
    DisconnectReason: pick('DisconnectReason'),
    fetchLatestBaileysVersion: pick('fetchLatestBaileysVersion'),
    Browsers: pick('Browsers'),
    makeCacheableSignalKeyStore: pick('makeCacheableSignalKeyStore'),
    initAuthCreds: pick('initAuthCreds'),
    BufferJSON: pick('BufferJSON'),
    proto: pick('proto'),
    downloadContentFromMessage: pick('downloadContentFromMessage'),
    generateWAMessageFromContent: pick('generateWAMessageFromContent'),
  };
  if (typeof lib.makeWASocket !== 'function') throw new Error('Baileys loaded but makeWASocket was not found');
  return lib;
}

function baileys() {
  if (!lib) throw new Error('Baileys is not loaded yet');
  return lib;
}

module.exports = { loadBaileys, baileys };
