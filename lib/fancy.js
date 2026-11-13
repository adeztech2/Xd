// Turns A-Z, a-z, 0-9 into bold serif letters, e.g. TOTAL -> 𝐓𝐎𝐓𝐀𝐋
function boldSerif(text) {
  return [...String(text)].map((ch) => {
    const c = ch.codePointAt(0);
    if (c >= 65 && c <= 90) return String.fromCodePoint(0x1d400 + c - 65);
    if (c >= 97 && c <= 122) return String.fromCodePoint(0x1d41a + c - 97);
    if (c >= 48 && c <= 57) return String.fromCodePoint(0x1d7ce + c - 48);
    return ch;
  }).join('');
}

module.exports = { boldSerif };
