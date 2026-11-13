module.exports = [
  {
    name: 'owner',
    alias: ['dev', 'creator'],
    desc: 'Contact the developer',
    run: async ({ sock, jid, m }) => {
      const vcard = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        'FN:Arnold Adez',
        'ORG:ADEZ TECH;',
        'TEL;type=CELL;waid=254111783552:+254111783552',
        'END:VCARD',
      ].join('\n');
      await sock.sendMessage(
        jid,
        { contacts: { displayName: 'Arnold Adez', contacts: [{ vcard }] } },
        { quoted: m }
      );
    },
  },
];
