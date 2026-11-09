const { card, safe, pick } = require('../lib/style');

const QUOTES = [
  ['The only way to do great work is to love what you do.', 'Steve Jobs'],
  ['It always seems impossible until it is done.', 'Nelson Mandela'],
  ['Whether you think you can or you think you can’t, you’re right.', 'Henry Ford'],
  ['Discipline is choosing between what you want now and what you want most.', 'Abraham Lincoln'],
  ['Well done is better than well said.', 'Benjamin Franklin'],
  ['The best time to plant a tree was 20 years ago. The second best time is now.', 'Proverb'],
  ['Success is the sum of small efforts repeated day in and day out.', 'Robert Collier'],
  ['Do what you can, with what you have, where you are.', 'Theodore Roosevelt'],
  ['Dreams don’t work unless you do.', 'John C. Maxwell'],
  ['Small steps every day lead to big results.', 'Unknown'],
  ['Hard work beats talent when talent doesn’t work hard.', 'Tim Notke'],
  ['Don’t watch the clock; do what it does. Keep going.', 'Sam Levenson'],
];
const FACTS = [
  'Honey never spoils. Edible honey has been found in ancient Egyptian tombs.',
  'Octopuses have three hearts and blue blood.',
  'A day on Venus is longer than a year on Venus.',
  'Bananas are berries, but strawberries are not.',
  'Sharks are older than trees.',
  'Your brain uses about 20% of your body’s energy.',
  'Lightning is about five times hotter than the surface of the sun.',
  'There are more stars in the universe than grains of sand on Earth.',
  'A group of flamingos is called a flamboyance.',
  'The Eiffel Tower grows about 15 cm taller in summer because of heat.',
  'Wombat droppings are cube-shaped.',
  'Kenya’s Lake Turkana is the world’s largest permanent desert lake.',
];
const JOKES = [
  ['Why don’t programmers like nature?', 'It has too many bugs.'],
  ['Why did the phone go to school?', 'To become smarter.'],
  ['What do you call a fake noodle?', 'An impasta.'],
  ['Why was the computer cold?', 'It left its Windows open.'],
  ['Why did the scarecrow win an award?', 'He was outstanding in his field.'],
  ['What’s a bot’s favourite snack?', 'Microchips.'],
  ['Why do Java developers wear glasses?', 'Because they don’t C#.'],
  ['I told my WiFi we need to talk.', 'We just don’t have a connection anymore.'],
  ['Why did the math book look sad?', 'It had too many problems.'],
  ['What did the zero say to the eight?', 'Nice belt!'],
];
const BALL = [
  'Yes, definitely.', 'It is certain.', 'Without a doubt.', 'Most likely.', 'Signs point to yes.',
  'Ask again later.', 'Cannot predict now.', 'Don’t count on it.', 'My sources say no.', 'Very doubtful.',
];
const TRUTHS = [
  'What is the most embarrassing thing you have done in public?',
  'What is a secret talent you have never shown anyone?',
  'Who was your first crush?',
  'What is the last lie you told?',
  'What is your biggest fear?',
  'What is the worst gift you have ever received?',
  'What app on your phone do you use the most?',
  'What is one habit you wish you could drop?',
];
const DARES = [
  'Send a voice note singing the chorus of your favourite song.',
  'Change your WhatsApp status to “I love Mondays” for one hour.',
  'Text the 5th person in your chat list “I miss you”.',
  'Do 15 push-ups and send proof.',
  'Speak in rhymes for the next 5 messages.',
  'Send your funniest selfie right now.',
  'Tell the group your most unusual food combination.',
  'Write a poem about the last thing you ate.',
];
const PICKUPS = [
  'Are you WiFi? Because I’m feeling a connection.',
  'Are you a keyboard? You’re just my type.',
  'Do you have a map? I keep getting lost in your eyes.',
  'Is your name Google? Because you have everything I’m searching for.',
  'Are you a charger? Because I’d be lost without you.',
  'Are you made of copper and tellurium? Because you’re Cu-Te.',
];
const COMPLIMENTS = [
  'You have a great sense of humour.', 'You make people feel welcome.', 'Your hard work really shows.',
  'You are more capable than you think.', 'You light up the room.', 'You are a good friend.',
];
const ROASTS = [
  'You’re the reason the shampoo bottle has instructions.',
  'You bring everyone so much joy… when you leave the room.',
  'If laziness was a sport, you’d send someone else to compete.',
  'You’re not stupid, you just have bad luck when thinking.',
  'Your WiFi signal has more personality than you do.',
];

const needText = (ctx, example) => {
  if (!ctx.text) { ctx.reply(card('⚠️ ERROR', `Example: ${example}`)); return true; }
  return false;
};

module.exports = [
  { name: 'quote', desc: 'Random inspiring quote', run: safe('quote', async (ctx) => { const [q, a] = pick(QUOTES); await ctx.reply(card('💬 QUOTE', [`“${q}”`, `— ${a}`])); }) },
  { name: 'fact', desc: 'Random fun fact', run: safe('fact', async (ctx) => ctx.reply(card('🧠 FACT', pick(FACTS)))) },
  { name: 'flip', alias: ['coin'], desc: 'Flip a coin', run: safe('flip', async (ctx) => ctx.reply(card('🪙 COIN', `It landed on *${Math.random() < 0.5 ? 'HEADS' : 'TAILS'}*`))) },
  {
    name: 'dice', alias: ['roll'], desc: 'Roll a dice, e.g. .dice 20',
    run: safe('dice', async (ctx) => {
      const sides = Math.min(1000, Math.max(2, parseInt(ctx.args[0], 10) || 6));
      await ctx.reply(card('🎲 DICE', `d${sides} → *${1 + Math.floor(Math.random() * sides)}*`));
    }),
  },
  {
    name: '8ball', desc: 'Ask the magic 8-ball a question',
    run: safe('8ball', async (ctx) => {
      if (needText(ctx, '.8ball will I pass?')) return;
      await ctx.reply(card('🎱 8-BALL', [`Q: ${ctx.text.slice(0, 150)}`, `A: ${pick(BALL)}`]));
    }),
  },
  { name: 'joke', desc: 'Random joke', run: safe('joke', async (ctx) => { const [s, p] = pick(JOKES); await ctx.reply(card('😂 JOKE', [s, p])); }) },
  {
    name: 'choose', alias: ['pick'], desc: 'Pick one option, e.g. .choose tea | coffee',
    run: safe('choose', async (ctx) => {
      const options = (ctx.text || '').split(/[|,]/).map((s) => s.trim()).filter(Boolean);
      if (options.length < 2) return ctx.reply(card('⚠️ ERROR', 'Example: .choose tea | coffee'));
      await ctx.reply(card('🤔 CHOICE', `I choose: *${pick(options)}*`));
    }),
  },
  {
    name: 'rate', desc: 'Rate anything out of 10',
    run: safe('rate', async (ctx) => {
      if (needText(ctx, '.rate my cooking')) return;
      await ctx.reply(card('⭐ RATE', [ctx.text.slice(0, 100), `Score: *${Math.floor(Math.random() * 11)}/10*`]));
    }),
  },
  { name: 'truth', desc: 'Get a truth question', run: safe('truth', async (ctx) => ctx.reply(card('🔍 TRUTH', pick(TRUTHS)))) },
  { name: 'dare', desc: 'Get a dare', run: safe('dare', async (ctx) => ctx.reply(card('🔥 DARE', pick(DARES)))) },
  {
    name: 'ship', desc: 'Love match, e.g. .ship Amy & Brian',
    run: safe('ship', async (ctx) => {
      const names = (ctx.text || '').split(/&|\band\b|\+|,/i).map((s) => s.trim()).filter(Boolean);
      if (names.length < 2) return ctx.reply(card('⚠️ ERROR', 'Example: .ship Amy & Brian'));
      const seed = [...(names[0] + names[1]).toLowerCase()].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 101, 7);
      await ctx.reply(card('💘 SHIP', [`${names[0]} ❤️ ${names[1]}`, `Match: *${seed}%*`]));
    }),
  },
  { name: 'pickup', desc: 'Random pickup line', run: safe('pickup', async (ctx) => ctx.reply(card('😏 PICKUP', pick(PICKUPS)))) },
  { name: 'compliment', desc: 'Get a nice compliment', run: safe('compliment', async (ctx) => ctx.reply(card('🌸 COMPLIMENT', pick(COMPLIMENTS)))) },
  { name: 'roast', desc: 'Friendly roast', run: safe('roast', async (ctx) => ctx.reply(card('🔥 ROAST', pick(ROASTS)))) },
];
