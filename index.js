'use strict';

/**
 * BOTIFY-X Bootstrap
 * 1. Detects platform, loads its handler from platforms/
 * 2. Downloads core if not present (3 fallback methods)
 * 3. Checks GitHub for newer version — updates if found
 * 4. Loads core/.env into process.env so child inherits saved session ID
 * 5. Spawns botify.js (which handles session prompt itself) with auto-restart
 */

const { spawn, spawnSync } = require('child_process');
const path   = require('path');
const fs     = require('fs');
const https  = require('https');
const http   = require('http');
const AdmZip = require('adm-zip');

const CORE_DIR = path.resolve(__dirname, 'core');
const ENTRY    = path.join(CORE_DIR, 'botify.js');
const CORE_PKG = path.join(CORE_DIR, 'package.json');
const ENV_FILE = path.join(CORE_DIR, '.env');

const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '5', 10);
const RETRY_DELAY = parseInt(process.env.RETRY_DELAY || '5000', 10);

const METHOD1_GITHUB_URL        = 'https://github.com/Stark-iindustries/Core-botifyX/archive/refs/heads/main.zip';
const METHOD2_HOSTED_URL        = 'YOUR_URL_HERE';
const METHOD3_BACKUP_GITHUB_URL = 'YOUR_URL_HERE';
const GITHUB_REPO               = 'Stark-iindustries/Core-botifyX';

const cyan   = (t) => `\x1b[36m${t}\x1b[0m`;
const yellow = (t) => `\x1b[33m${t}\x1b[0m`;
const red    = (t) => `\x1b[31m${t}\x1b[0m`;
const sleep  = (ms) => new Promise(r => setTimeout(r, ms));

function detectPlatform() {
    const e = process.env;
    if (e.RAILWAY_SERVICE_ID || e.RAILWAY_STATIC_URL || e.RAILWAY_ENVIRONMENT) return 'Railway';
    if (e.DYNO)           return 'Heroku';
    if (e.RENDER)         return 'Render';
    if (e.KOYEB_APP_NAME) return 'Koyeb';
    if (e.FLY_APP_NAME)   return 'Fly.io';
    if (e.P_SERVER_UUID || e.PTERODACTYL_UUID ||
        /pterodactyl|katabump/i.test(e.HOSTNAME || '')) return 'Pterodactyl';
    if (e.TERMUX_VERSION ||
        (e.PREFIX && e.SHELL && e.SHELL.includes('com.termux'))) return 'Termux';
    return 'Local';
}

async function banner(platformName) {
    console.log('');
    console.log(cyan('  \u2588\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2557   \u2588\u2588\u2557    \u2588\u2588\u2557  \u2588\u2588\u2557'));
    console.log(cyan('  \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2550\u2588\u2588\u2557\u255a\u2550\u2550\u2588\u2588\u2554\u2550\u2550\u255d\u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255d\u255a\u2588\u2588\u2557 \u2588\u2588\u2554\u255d    \u255a\u2588\u2588\u2557\u2588\u2588\u2554\u255d'));
    console.log(cyan('  \u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d\u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2557   \u255a\u2588\u2588\u2588\u2588\u2554\u255d      \u255a\u2588\u2588\u2588\u2554\u255d '));
    console.log(cyan('  \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u255d    \u255a\u2588\u2588\u2554\u255d       \u2588\u2588\u2554\u2588\u2588\u2557 '));
    console.log(cyan('  \u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d\u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d   \u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2551        \u2588\u2588\u2551        \u2588\u2588\u2554\u255d \u2588\u2588\u2557'));
    console.log(cyan('  \u255a\u2550\u2550\u2550\u2550\u2550\u255d  \u255a\u2550\u2550\u2550\u2550\u2550\u255d    \u255a\u2550\u255d   \u255a\u2550\u255d\u255a\u2550\u255d        \u255a\u2550\u255d        \u255a\u2550\u255d  \u255a\u2550\u255d'));
    console.log('');
    await sleep(2000);
    console.log(cyan(`  [BOTIFY-X] Platform : ${platformName}`));
    await sleep(2000);
    console.log(cyan(`  [BOTIFY-X] Node.js  : ${process.version}`));
    await sleep(2000);
    console.log('');
}

function downloadBuffer(url, redirects = 0) {
    if (redirects > 5) return Promise.reject(new Error('Too many redirects'));
    return new Promise((resolve, reject) => {
        const client  = url.startsWith('https') ? https : http;
        const request = client.get(url, { timeout: 60000 }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
                return downloadBuffer(res.headers.location, redirects + 1).then(resolve).catch(reject);
            if (res.statusCode !== 200)
                return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end',  () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        });
        request.on('error',   reject);
        request.on('timeout', () => { request.destroy(); reject(new Error(`Timeout: ${url}`)); });
    });
}

async function extractZip(buffer) {
    console.log(cyan('[BOTIFY-X] Processing...'));
    await sleep(2000);
    const zip     = new AdmZip(buffer);
    const entries = zip.getEntries();
    let prefix    = '';
    if (entries.length > 0) {
        const topDir = entries[0].entryName.split('/')[0];
        if (entries.every(e => e.entryName.startsWith(topDir + '/'))) prefix = topDir + '/';
    }
    fs.mkdirSync(CORE_DIR, { recursive: true });
    for (const entry of entries) {
        if (entry.isDirectory) continue;
        const rel = prefix ? entry.entryName.slice(prefix.length) : entry.entryName;
        if (!rel) continue;
        const dest = path.join(CORE_DIR, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, entry.getData());
    }
    console.log(cyan('[BOTIFY-X] Processed successfully.'));
    await sleep(2000);
}

async function downloadCore() {
    const methods = [
        { label: 'method 1 from server one', url: METHOD1_GITHUB_URL },
        { label: 'method 2 from server one', url: METHOD2_HOSTED_URL },
        { label: 'method 3 from server two', url: METHOD3_BACKUP_GITHUB_URL },
    ];
    for (const { label, url } of methods) {
        if (!url || url === 'YOUR_URL_HERE') {
            console.warn(red(`[BOTIFY-X] \u26a0\ufe0f  ${label} \u2014 URL not configured, skipping.`));
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
            console.error(red(`[BOTIFY-X] \u274c ${label} failed: ${err.message}`));
            await sleep(2000);
        }
    }
    return false;
}

function isNewer(l, c) {
    const p = s => (s||'0').replace(/^v/,'').split('.').map(n=>parseInt(n,10)||0);
    const a = p(l), b = p(c);
    for (let i = 0; i < 3; i++) { if (a[i]>b[i]) return true; if (a[i]<b[i]) return false; }
    return false;
}

async function checkAndUpdate() {
    let cur = '0.0.0';
    try { cur = JSON.parse(fs.readFileSync(CORE_PKG,'utf8')).version || '0.0.0'; } catch(_){}
    console.log(cyan(`[BOTIFY-X] Checking for updates (current: v${cur})\u2026`));
    await sleep(2000);
    try {
        const buf     = await downloadBuffer(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
        const release = JSON.parse(buf.toString('utf8'));
        const latest  = (release.tag_name||'').replace(/^v/,'');
        if (!latest) { console.log(cyan('[BOTIFY-X] \u2139\ufe0f  No release found \u2014 skipping.')); return; }
        if (!isNewer(latest, cur)) { console.log(cyan(`[BOTIFY-X] \u2705 Already on latest (v${cur}).`)); return; }
        console.log(yellow(`[BOTIFY-X] \uD83C\uDD99 New version v${latest} available. Updating\u2026`));
        const ok = await downloadCore();
        if (!ok) { console.error(red('[BOTIFY-X] \u274c Update failed \u2014 running existing.')); return; }
        await runNpmInstall();
        console.log(cyan(`[BOTIFY-X] \u2705 Updated to v${latest}.`));
    } catch (err) {
        console.error(`[BOTIFY-X] \u26a0\ufe0f  Update check error: ${err.message} \u2014 continuing.`);
    }
}

async function runNpmInstall() {
    const pinoDir = path.join(CORE_DIR, 'node_modules', 'pino');
    if (fs.existsSync(pinoDir)) { console.log(cyan('[BOTIFY-X] Dependencies already installed \u2014 skipping.')); return; }
    console.log(cyan('[BOTIFY-X] Installing dependencies using npm...'));
    await sleep(2000);
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    let r = spawnSync(npm, ['install', '--omit=dev'], { cwd: CORE_DIR, stdio: 'inherit', env: process.env });
    if (r.status !== 0) r = spawnSync(npm, ['install', '--production'], { cwd: CORE_DIR, stdio: 'inherit', env: process.env });
    if (r.status !== 0) console.warn(yellow('[BOTIFY-X] \u26a0\ufe0f  npm install had errors \u2014 some features may not work.'));
    else { console.log(cyan('[BOTIFY-X] Dependencies installed successfully.')); await sleep(2000); }
}

let attempts = 0;
function launch() {
    if (!fs.existsSync(ENTRY)) { console.error(red(`[BOTIFY-X] \u274c Entry not found: ${ENTRY}`)); process.exit(1); }
    const child = spawn(process.execPath, [ENTRY], { cwd: CORE_DIR, stdio: 'inherit', env: process.env });
    child.on('exit', (code, signal) => {
        if (code === 0 || signal === 'SIGTERM') { console.log(cyan('[BOTIFY-X] Process exited cleanly.')); process.exit(0); }
        attempts++;
        if (attempts >= MAX_RETRIES) { console.error(red(`[BOTIFY-X] Crashed ${attempts} times. Giving up.`)); process.exit(1); }
        const delay = Math.min(RETRY_DELAY * attempts, 60000);
        console.log(red(`[BOTIFY-X] Crashed (code=${code}). Restarting in ${delay/1000}s\u2026`));
        setTimeout(launch, delay);
    });
    process.once('SIGINT',  () => child.kill('SIGINT'));
    process.once('SIGTERM', () => child.kill('SIGTERM'));
}

(async () => {
    const platformName = detectPlatform();
    await banner(platformName);

    if (!fs.existsSync(ENTRY)) {
        console.log(cyan('[BOTIFY-X] Core not found locally. Downloading\u2026'));
        await sleep(2000);
        const ok = await downloadCore();
        if (!ok) { console.error(red('[BOTIFY-X] \u274c All download methods failed.')); process.exit(1); }
        await runNpmInstall();
    } else {
        await checkAndUpdate();
        await runNpmInstall(); // always verify deps even on existing core
    }

    // Load any values saved in core/.env (e.g. SESSION_ID from a previous prompt)
    // into process.env so the child process inherits them without needing a panel variable.
    if (fs.existsSync(ENV_FILE)) {
        for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
            const eq = line.indexOf('=');
            if (eq < 1) continue;
            const key = line.slice(0, eq).trim();
            const val = line.slice(eq + 1).trim();
            if (key && val && !process.env[key]) process.env[key] = val;
        }
    }

    // Session prompting is handled entirely inside botify.js
    launch();
})();
