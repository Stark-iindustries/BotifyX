'use strict';

/**
 * BOTIFY-X Bootstrap
 * ---------------------------------
 * On every start:
 *   1. Downloads core if not present (3 fallback methods).
 *   2. Checks GitHub for a newer version — downloads + updates if found.
 *   3. Spawns botify.js with auto-restart on crash.
 *
 * Supported platforms: Railway, Heroku, Render, Koyeb, Fly.io,
 *                      Pterodactyl, Termux, Windows, macOS, Linux.
 */

const { spawn, spawnSync } = require('child_process');
const path   = require('path');
const fs     = require('fs');
const https  = require('https');
const http   = require('http');
const AdmZip = require('adm-zip');

// ─── Paths ────────────────────────────────────────────────────────────────────
const CORE_DIR = path.resolve(__dirname, 'core');
const ENTRY    = path.join(CORE_DIR, 'botify.js');
const CORE_PKG = path.join(CORE_DIR, 'package.json');

// ─── Watchdog config ──────────────────────────────────────────────────────────
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '5', 10);
const RETRY_DELAY = parseInt(process.env.RETRY_DELAY || '5000', 10);

// ─── Download sources ─────────────────────────────────────────────────────────
const METHOD1_GITHUB_URL        = 'https://github.com/Stark-iindustries/Core-botifyX/archive/refs/heads/main.zip';
const METHOD2_HOSTED_URL        = 'YOUR_URL_HERE';
const METHOD3_BACKUP_GITHUB_URL = 'YOUR_URL_HERE';

// ─── GitHub repo for update version checks ────────────────────────────────────
const GITHUB_REPO = 'Stark-iindustries/Core-botifyX';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const cyan   = (t) => `\x1b[36m${t}\x1b[0m`;
const yellow = (t) => `\x1b[33m${t}\x1b[0m`;
const red    = (t) => `\x1b[31m${t}\x1b[0m`;
const green  = (t) => `\x1b[32m${t}\x1b[0m`;
const sleep  = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Platform detection ───────────────────────────────────────────────────────
function detectPlatform() {
    const env = process.env;
    if (env.RAILWAY_SERVICE_ID || env.RAILWAY_STATIC_URL || env.RAILWAY_ENVIRONMENT) return 'Railway';
    if (env.DYNO)           return 'Heroku';
    if (env.RENDER)         return 'Render';
    if (env.KOYEB_APP_NAME) return 'Koyeb';
    if (env.FLY_APP_NAME)   return 'Fly.io';
    if (env.P_SERVER_UUID || env.PTERODACTYL_UUID ||
        (env.HOSTNAME && env.HOSTNAME.startsWith('pterodactyl'))) return 'Pterodactyl';
    if (env.TERMUX_VERSION ||
        (env.PREFIX && env.SHELL && env.SHELL.includes('com.termux'))) return 'Termux';
    return 'Local';
}

// ─── Banner ───────────────────────────────────────────────────────────────────
function banner() {
    console.log('');
    console.log(cyan('  ██████╗  ██████╗ ████████╗██╗███████╗██╗   ██╗    ██╗  ██╗'));
    console.log(cyan('  ██╔══██╗██╔═══██╗╚══██╔══╝██║██╔════╝╚██╗ ██╔╝    ╚██╗██╔╝'));
    console.log(cyan('  ██████╔╝██║   ██║   ██║   ██║█████╗   ╚████╔╝      ╚███╔╝ '));
    console.log(cyan('  ██╔══██╗██║   ██║   ██║   ██║██╔══╝    ╚██╔╝       ██╔██╗ '));
    console.log(cyan('  ██████╔╝╚██████╔╝   ██║   ██║██║        ██║        ██╔╝ ██╗'));
    console.log(cyan('  ╚═════╝  ╚═════╝    ╚═╝   ╚═╝╚═╝        ╚═╝        ╚═╝  ╚═╝'));
    console.log('');
    console.log(cyan(`  [BOTIFY-X] Platform : ${detectPlatform()}`));
    console.log(cyan(`  [BOTIFY-X] Node.js  : ${process.version}`));
    console.log('');
}

// ─── HTTP/HTTPS downloader (follows redirects) ────────────────────────────────
function downloadBuffer(url, redirects = 0) {
    if (redirects > 5) return Promise.reject(new Error('Too many redirects'));
    return new Promise((resolve, reject) => {
        const client  = url.startsWith('https') ? https : http;
        const request = client.get(url, { timeout: 60000 }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return downloadBuffer(res.headers.location, redirects + 1).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            }
            const chunks = [];
            res.on('data',  chunk => chunks.push(chunk));
            res.on('end',   () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        });
        request.on('error',   reject);
        request.on('timeout', () => { request.destroy(); reject(new Error(`Timeout: ${url}`)); });
    });
}

// ─── Extract zip into CORE_DIR ────────────────────────────────────────────────
async function extractZip(buffer) {
    console.log(cyan('[BOTIFY-X] Processing...'));
    await sleep(2000);

    const zip     = new AdmZip(buffer);
    const entries = zip.getEntries();

    let prefix = '';
    if (entries.length > 0) {
        const first  = entries[0].entryName;
        const topDir = first.split('/')[0];
        if (entries.every(e => e.entryName.startsWith(topDir + '/'))) {
            prefix = topDir + '/';
        }
    }

    fs.mkdirSync(CORE_DIR, { recursive: true });
    for (const entry of entries) {
        if (entry.isDirectory) continue;
        const relative = prefix ? entry.entryName.slice(prefix.length) : entry.entryName;
        if (!relative) continue;
        const dest = path.join(CORE_DIR, relative);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, entry.getData());
    }

    console.log(cyan('[BOTIFY-X] Processed successfully.'));
    await sleep(2000);
}

// ─── Try all 3 methods in order ───────────────────────────────────────────────
async function downloadCore() {
    const methods = [
        { label: 'method 1 from server one', url: METHOD1_GITHUB_URL },
        { label: 'method 2 from server one', url: METHOD2_HOSTED_URL },
        { label: 'method 3 from server two', url: METHOD3_BACKUP_GITHUB_URL },
    ];

    for (const { label, url } of methods) {
        if (!url || url === 'YOUR_URL_HERE') {
            console.warn(red(`[BOTIFY-X] ⚠️  ${label} — URL not configured, skipping.`));
            await sleep(2000);
            continue;
        }
        try {
            console.log(cyan(`[BOTIFY-X] Trying ${label}...`));
            const buffer = await downloadBuffer(url);
            await sleep(2000);
            console.log(cyan(`[BOTIFY-X] Successfully connected via ${label}`));
            await sleep(2000);
            await extractZip(buffer);
            return true;
        } catch (err) {
            console.error(red(`[BOTIFY-X] ❌ ${label} failed: ${err.message}`));
            await sleep(2000);
        }
    }
    return false;
}

// ─── Semver compare ───────────────────────────────────────────────────────────
function isNewer(latestStr, currentStr) {
    const parse = (s) => (s || '0').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
    const l = parse(latestStr);
    const c = parse(currentStr);
    for (let i = 0; i < 3; i++) {
        if ((l[i] || 0) > (c[i] || 0)) return true;
        if ((l[i] || 0) < (c[i] || 0)) return false;
    }
    return false;
}

// ─── Check GitHub for a newer version ────────────────────────────────────────
async function checkAndUpdate() {
    if (!GITHUB_REPO || GITHUB_REPO === 'YOUR_GITHUB_USERNAME/YOUR_REPO_NAME') {
        console.log(cyan('[BOTIFY-X] ℹ️  GITHUB_REPO not set — update check skipped.'));
        return;
    }

    let currentVersion = '0.0.0';
    try {
        const pkg = JSON.parse(fs.readFileSync(CORE_PKG, 'utf8'));
        currentVersion = pkg.version || '0.0.0';
    } catch (_) {}

    console.log(cyan(`[BOTIFY-X] Checking for updates (current: v${currentVersion})…`));

    try {
        const apiUrl  = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
        const buffer  = await downloadBuffer(apiUrl);
        const release = JSON.parse(buffer.toString('utf8'));
        const latest  = (release.tag_name || '').replace(/^v/, '');

        if (!latest) {
            console.log(cyan('[BOTIFY-X] ℹ️  No release found on GitHub — skipping update.'));
            return;
        }

        if (!isNewer(latest, currentVersion)) {
            console.log(cyan(`[BOTIFY-X] ✅ Already on latest version (v${currentVersion}).`));
            return;
        }

        console.log(yellow(`[BOTIFY-X] 🆙 New version available: v${latest}. Updating…`));
        const downloaded = await downloadCore();

        if (!downloaded) {
            console.error(red('[BOTIFY-X] ❌ Update download failed — running existing version.'));
            return;
        }

        await runNpmInstall();
        console.log(cyan(`[BOTIFY-X] ✅ Updated to v${latest} successfully.`));
    } catch (err) {
        console.error(`[BOTIFY-X] ⚠️  Update check error: ${err.message} — continuing with current version.`);
    }
}

// ─── npm install helper ────────────────────────────────────────────────────────
// Checks for a key dependency (pino) — if missing, always runs npm install
// even if node_modules/ exists, to handle partial or stale installs.
async function runNpmInstall() {
    const pinoDir = path.join(CORE_DIR, 'node_modules', 'pino');

    if (fs.existsSync(pinoDir)) {
        console.log(cyan('[BOTIFY-X] Dependencies already installed — skipping.'));
        return;
    }

    console.log(cyan('[BOTIFY-X] Installing dependencies using npm...'));
    await sleep(2000);

    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

    let result = spawnSync(npm, ['install', '--omit=dev'], {
        cwd: CORE_DIR, stdio: 'inherit', env: process.env,
    });
    if (result.status !== 0) {
        result = spawnSync(npm, ['install', '--production'], {
            cwd: CORE_DIR, stdio: 'inherit', env: process.env,
        });
    }
    if (result.status !== 0) {
        console.warn(yellow('[BOTIFY-X] ⚠️  npm install exited with errors — some features may not work.'));
    } else {
        console.log(cyan('[BOTIFY-X] Dependencies installed successfully.'));
        await sleep(2000);
    }
}

// ─── Launch loop ──────────────────────────────────────────────────────────────
let attempts = 0;

function launch() {
    if (!fs.existsSync(ENTRY)) {
        console.error(red(`[BOTIFY-X] ❌ Entry not found: ${ENTRY}`));
        process.exit(1);
    }

    const child = spawn(process.execPath, [ENTRY], {
        cwd:   CORE_DIR,
        stdio: 'inherit',
        env:   process.env,
    });

    child.on('exit', (code, signal) => {
        if (code === 0 || signal === 'SIGTERM') {
            console.log(cyan('[BOTIFY-X] Process exited cleanly. Shutting down.'));
            process.exit(0);
        }

        attempts++;
        if (attempts >= MAX_RETRIES) {
            console.error(red(`[BOTIFY-X] Crashed ${attempts} times. Giving up.`));
            process.exit(1);
        }

        const delay = Math.min(RETRY_DELAY * attempts, 60000);
        console.log(red(`[BOTIFY-X] Crashed (code=${code}). Restarting in ${delay / 1000}s…`));
        setTimeout(launch, delay);
    });

    process.once('SIGINT',  () => { child.kill('SIGINT');  });
    process.once('SIGTERM', () => { child.kill('SIGTERM'); });
}

// ─── Entry point ──────────────────────────────────────────────────────────────
(async () => {
    banner();

    if (!fs.existsSync(ENTRY)) {
        console.log(cyan('[BOTIFY-X] Core not found locally. Downloading…'));
        await sleep(2000);
        const ok = await downloadCore();
        if (!ok) {
            console.error(red('[BOTIFY-X] ❌ All download methods failed. Cannot continue.'));
            process.exit(1);
        }
        await runNpmInstall();
    } else {
        await checkAndUpdate();
    }

    launch();
})();
