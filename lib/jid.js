// Same result as Baileys' jidNormalizedUser: removes the device part, maps c.us to s.whatsapp.net.
function jidNormalizedUser(jid = '') {
  const m = /^([^:@]+)(?::\d+)?@(.+)$/.exec(jid);
  if (!m) return jid;
  return `${m[1]}@${m[2] === 'c.us' ? 's.whatsapp.net' : m[2]}`;
}

module.exports = { jidNormalizedUser };
