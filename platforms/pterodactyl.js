'use strict';
// Pterodactyl / Katabump panels — support console input
module.exports = {
  supportsConsoleInput: true,
  getSessionId() { return process.env.SESSION_ID || null; },
  noSessionMessage() {
    console.log('\x1b[31m[BOTIFY-X] No SESSION_ID found — enter it below or set it in panel variables.\x1b[0m');
  },
  async promptSessionId(envFile) {
    const readline = require('readline');
    const fs = require('fs');
    return new Promise((resolve, reject) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ask = () => {
        process.stdout.write('\x1b[31m\nPlease wait for a few seconds to enter your session id!\n\x1b[0m');
        process.stdout.write('\x1b[36m[BOTIFY-X] Format: BOTIFY-X=<base64string>\n\x1b[0m');
        process.stdout.write('\nPaste Session ID \u2192 ');
        rl.once('line', (input) => {
          const id = input.trim();
          if (!id) { process.stdout.write('\x1b[31m[BOTIFY-X] Nothing entered. Try again.\n\n\x1b[0m'); return ask(); }
          if (!id.startsWith('BOTIFY-X=') && !id.startsWith('MEGA-')) {
            process.stdout.write('\x1b[31m[BOTIFY-X] \u274c Invalid format. Must start with BOTIFY-X= or MEGA-\n\n\x1b[0m'); return ask();
          }
          rl.close();
          let lines = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8').split('\n') : [];
          const idx = lines.findIndex(l => l.startsWith('SESSION_ID='));
          if (idx >= 0) lines[idx] = 'SESSION_ID=' + id; else lines.push('SESSION_ID=' + id);
          fs.writeFileSync(envFile, lines.join('\n'), 'utf8');
          process.env.SESSION_ID = id;
          process.stdout.write('\x1b[32m[BOTIFY-X] \u2705 Session ID saved.\n\n\x1b[0m');
          resolve(id);
        });
      };
      rl.on('error', reject);
      ask();
    });
  },
};