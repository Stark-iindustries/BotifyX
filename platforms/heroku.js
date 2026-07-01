'use strict';
module.exports = {
  supportsConsoleInput: false,
  getSessionId() { return process.env.SESSION_ID || null; },
  noSessionMessage() {
    console.log('\x1b[31m[BOTIFY-X] \u274c SESSION_ID is not set.\x1b[0m');
    console.log('\x1b[36m[BOTIFY-X] Heroku \u2192 Settings \u2192 Config Vars \u2192 add SESSION_ID = BOTIFY-X=...\x1b[0m');
    console.log('\x1b[36m[BOTIFY-X] Then redeploy.\x1b[0m');
  },
};