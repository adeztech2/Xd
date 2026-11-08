// Let common informational commands work without a prefix when the whole message is the command.
// This intentionally does not interpret arbitrary chat as a command.
const COMMANDS = new Map([
  ['menu', 'menu'], ['help', 'menu'], ['alive', 'alive'], ['ping', 'ping'],
  ['uptime', 'uptime'], ['time', 'time'], ['date', 'date'], ['owner', 'owner'],
]);

module.exports = {
  name: 'plain-commands',
  events: {
    message: async (ctx) => {
      const name = COMMANDS.get((ctx.body || '').trim().toLowerCase());
      if (!name) return;
      const command = ctx.list.find((entry) => entry.name === name);
      if (command) await command.run(ctx);
    },
  },
};
