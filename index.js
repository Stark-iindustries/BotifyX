'use strict';

/**
 * BOTIFY-X Bootstrap
 * ---------------------------------
 * Starts botify.js from the core directory with auto-restart on crash.
 * Railway / Heroku / Render friendly — exits with 0 on graceful shutdown,
 * restarts on non-zero exits up to MAX_RETRIES times.
 */

const { spawn } = require('child_process');
const path      = require('path');
const fs        = require('fs');

// ─── Configuration ────────────────────────────────────────────────────────────
const CORE_DIR   = path.resolve(__dirname, '..', 'core');
const ENTRY      = path.join(CORE_DIR, 'botify.js');
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '5', 10);
const RETRY_DELAY = parseInt(process.env.RETRY_DELAY || '5000', 10); // ms

// ─── Platform detection ───────────────────────────────────────────────────────
function detectPlatform() {
    const env = process.env;
    if (env.RAILWAY_SERVICE_ID || env.RAILWAY_STATIC_URL || env.RAILWAY_ENVIRONMENT) return 'Railway';
    if (env.DYNO)           return 'Heroku';
    if (env.RENDER)         return 'Render';
    if (env.KOYEB_APP_NAME) return 'Koyeb';
    if (env.FLY_APP_NAME)   return 'Fly.io';
    return 'Local';
}

// ─── Banner ───────────────────────────────────────────────────────────────────
function banner() {
    console.log('╔══════════════════════════════════╗');
    console.log('║         B O T I F Y - X          ║');
    console.log('║   WhatsApp Bot by Mr Stark        ║');
    console.log('║   https://t.me/botifyxspace       ║');
    console.log('╚══════════════════════════════════╝');
    console.log(`[BOTIFY-X] Platform : ${detectPlatform()}`);
    console.log(`[BOTIFY-X] Node.js  : ${process.version}`);
    console.log(`[BOTIFY-X] Entry    : ${ENTRY}`);
    console.log('');
}

// ─── Validate ─────────────────────────────────────────────────────────────────
if (!fs.existsSync(ENTRY)) {
    console.error(`[BOTIFY-X] ERROR: Core entry not found at ${ENTRY}`);
    console.error('[BOTIFY-X] Make sure the core/ directory is present.');
    process.exit(1);
}

// ─── Launch loop ──────────────────────────────────────────────────────────────
banner();

let attempts = 0;

function launch() {
    console.log(`[BOTIFY-X] Starting botify.js (attempt ${attempts + 1})…`);

    const child = spawn(process.execPath, [ENTRY], {
        cwd:   CORE_DIR,
        stdio: 'inherit',
        env:   process.env,
    });

    child.on('exit', (code, signal) => {
        if (code === 0 || signal === 'SIGTERM') {
            console.log('[BOTIFY-X] Process exited cleanly. Shutting down.');
            process.exit(0);
        }

        attempts++;
        if (attempts >= MAX_RETRIES) {
            console.error(`[BOTIFY-X] Crashed ${attempts} times. Giving up.`);
            process.exit(1);
        }

        const delay = Math.min(RETRY_DELAY * attempts, 60000);
        console.log(`[BOTIFY-X] Crashed (code=${code}). Restarting in ${delay / 1000}s…`);
        setTimeout(launch, delay);
    });

    // Graceful shutdown
    process.once('SIGINT',  () => { child.kill('SIGINT');  });
    process.once('SIGTERM', () => { child.kill('SIGTERM'); });
}

launch();
