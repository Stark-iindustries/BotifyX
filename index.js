'use strict';

/**
 * BOTIFY-X Bootstrap
 *
 * SESSION_ID priority:
 *   1. process.env.SESSION_ID  (panel variable — Railway, Koyeb, etc.)
 *   2. .env in THIS directory  (user fills it in before starting, or we save it here)
 *   3. core/.env               (saved by botify.js from a previous interactive run)
 *   4. Interactive console prompt (fallback — may fail on some panel environments)
 *
 * On Katabump / Pterodactyl: fill SESSION_ID= in the .env file that ships with
 * this bootstrap. No console prompt needed, no stdin crash.
 */

const { spawn, spawnSync } = require('child_process');
const path   = require('path');
const fs     = require('fs');
const https  = require('https');
const http   = require('http');
const AdmZip = require('adm-zip');

const BOOTSTRAP_DIR = __dirname;
const CORE_DIR      = path.resolve(BOOTSTRAP_DIR, 'core');
const ENTRY         = path.join(CORE_DIR, 'botify.js');
// .env in the bootstrap folder (ships with the zip, user fills it in)
const BOOTSTRAP_ENV = path.join(BOOTSTRAP_DIR, '.env');
// .env inside core (written by botify.js when session ID is entered interactively)
const CORE_ENV      = path.join(CORE_DIR, '.env');

const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '5', 10);
const RETRY_DELAY = parseInt(process.env.RETRY_DELAY || '5000', 10);

const METHOD1_GITHUB_URL        = 'https://github.com/Stark-iindustries/Core-botifyX/archive/refs/heads/main.zip';
const METHOD2_HOSTED_URL        = 'YOUR_URL_HERE';
const METHOD3_BACKUP_GITHUB_URL = 'YOUR_URL_HERE';
const BOOTSTRAP_REPO            = 'Stark-iindustries/BotifyX';
const GITHUB_HEADERS            = { 'User-Agent': 'BotifyX-Bootstrap', 'Accept': 'application/vnd.github+json' };

// Backup paths — shared between applyUpdate and startup restore
const DB_SRC  = path.join(CORE_DIR,      'src', 'Database', 'database.json');
const DB_BAK  = path.join(BOOTSTRAP_DIR, '.botify-db-backup.json');
const ENV_SRC = path.join(CORE_DIR,      '.env');
const ENV_BAK = path.join(BOOTSTRAP_DIR, '.botify-env-backup');
const SES_SRC = path.join(CORE_DIR,      'src', 'Session');
const SES_BAK = path.join(BOOTSTRAP_DIR, '.botify-session-backup');

const cyan   = (t) => `\x1b[36m${t}\x1b[0m`;
const yellow = (t) => `\x1b[33m${t}\x1b[0m`;
const red    = (t) => `\x1b[31m${t}\x1b[0m`;
const green  = (t) => `\x1b[32m${t}\x1b[0m`;
const sleep  = (ms) => new Promise(r => setTimeout(r, ms));

// ── Load a .env file into process.env (does NOT overwrite already-set vars) ──
function loadEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return;
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq  = line.indexOf('=');
        if (eq < 1) continue;
        const key = line.slice(0, eq).trim();
        const val = line.slice(eq + 1).trim();
        if (key && val && !process.env[key]) process.env[key] = val;
    }
}

// ── Write a key=value line into the bootstrap .env ───────────────────────────
function writeBootstrapEnvKey(key, value) {
    let lines = fs.existsSync(BOOTSTRAP_ENV)
        ? fs.readFileSync(BOOTSTRAP_ENV, 'utf8').split('\n')
        : [];
    const idx  = lines.findIndex(l => l.startsWith(key + '='));
    const line = `${key}=${value}`;
    if (idx >= 0) lines[idx] = line;
    else lines.push(line);
    fs.writeFileSync(BOOTSTRAP_ENV, lines.join('\n'), 'utf8');
}

function detectPlatform() {
    const e = process.env;
    if (e.RAILWAY_SERVICE_ID || e.RAILWAY_STATIC_URL) return 'Railway';
    if (e.DYNO)           return 'Heroku';
    if (e.RENDER)         return 'Render';
    if (e.KOYEB_APP_NAME) return 'Koyeb';
    if (e.FLY_APP_NAME)   return 'Fly.io';
    if (e.P_SERVER_UUID || e.PTERODACTYL_UUID ||
        /pterodactyl|katabump/i.test(e.HOSTNAME || '')) return 'Pterodactyl';
    if (e.TERMUX_VERSION  ||
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

function downloadBuffer(url, redirects = 0, extraHeaders = {}) {
    if (redirects > 5) return Promise.reject(new Error('Too many redirects'));
    return new Promise((resolve, reject) => {
        const client  = url.startsWith('https') ? https : http;
        const request = client.get(url, { timeout: 60000, headers: extraHeaders }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location)
                return downloadBuffer(res.headers.location, redirects + 1, extraHeaders).then(resolve).catch(reject);
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

    function isNewer(latest, current) {
      const parse = s => (s || '0').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
      const a = parse(latest), b = parse(current);
      for (let i = 0; i < 3; i++) { if (a[i] > b[i]) return true; if (a[i] < b[i]) return false; }
      return false;
    }

    // ── Fetch latest BotifyX release tag from GitHub ─────────────────────────────
    async function fetchLatestRelease() {
      const buf     = await downloadBuffer(
          `https://api.github.com/repos/${BOOTSTRAP_REPO}/releases/latest`,
          0, GITHUB_HEADERS
      );
      const release = JSON.parse(buf.toString('utf8'));
      return (release.tag_name || '').replace(/^v/, '');
    }

    // ── Backup settings, session and core .env before update ─────────────────────
    function backupSettings() {
      if (fs.existsSync(DB_SRC)) {
          fs.copyFileSync(DB_SRC, DB_BAK);
          console.log(cyan('[BOTIFY-X] ✓  Settings backed up'));
      }
      if (fs.existsSync(ENV_SRC)) fs.copyFileSync(ENV_SRC, ENV_BAK);
      if (fs.existsSync(SES_SRC)) {
          fs.mkdirSync(SES_BAK, { recursive: true });
          for (const f of fs.readdirSync(SES_SRC)) {
              const s = path.join(SES_SRC, f);
              if (fs.statSync(s).isFile()) fs.copyFileSync(s, path.join(SES_BAK, f));
          }
          console.log(cyan('[BOTIFY-X] ✓  Session backed up'));
      }
    }

    // ── Restore settings, session and core .env after update ─────────────────────
    function restoreSettings() {
      if (fs.existsSync(DB_BAK)) {
          fs.mkdirSync(path.dirname(DB_SRC), { recursive: true });
          fs.copyFileSync(DB_BAK, DB_SRC);
          fs.unlinkSync(DB_BAK);
          console.log(cyan('[BOTIFY-X] ✓  Settings restored'));
      }
      if (fs.existsSync(ENV_BAK)) {
          fs.copyFileSync(ENV_BAK, ENV_SRC);
          fs.unlinkSync(ENV_BAK);
      }
      if (fs.existsSync(SES_BAK)) {
          fs.mkdirSync(SES_SRC, { recursive: true });
          for (const f of fs.readdirSync(SES_BAK)) {
              fs.copyFileSync(path.join(SES_BAK, f), path.join(SES_SRC, f));
          }
          fs.rmSync(SES_BAK, { recursive: true, force: true });
          console.log(cyan('[BOTIFY-X] ✓  Session restored'));
      }
    }

    // ── State: update orchestration ───────────────────────────────────────────────
    let updatingNow     = false;
    let currentChild    = null;
    let updateScheduled = false;

    // ── Apply deferred update: kill Core -> backup -> wipe -> download -> restore -
    async function applyUpdate(latestTag) {
      if (updatingNow) return;
      updatingNow = true;
      const SEP = cyan('[BOTIFY-X] ' + '━'.repeat(40));
      console.log('');
      console.log(SEP);
      console.log(cyan(`[BOTIFY-X] ⏰  3-hour timer elapsed — applying update → v${latestTag}`));
      console.log(SEP);
      console.log('');
      await sleep(2000);

      if (currentChild) {
          console.log(cyan('[BOTIFY-X] Stopping current Core...'));
          currentChild.kill('SIGTERM');
          await sleep(3000);
      }

      backupSettings();

      if (fs.existsSync(CORE_DIR)) {
          fs.rmSync(CORE_DIR, { recursive: true, force: true });
          console.log(cyan('[BOTIFY-X] ✓  Old Core wiped'));
      }

      console.log(cyan('[BOTIFY-X] Downloading latest Core...'));
      const ok = await downloadCore();
      if (!ok) {
          console.error(red('[BOTIFY-X] ❌  Download failed.'));
          console.error(red('[BOTIFY-X]    Settings backup preserved. Restart the bot to retry.'));
          updatingNow = false;
          process.exit(1);
          return;
      }

      restoreSettings();
      writeBootstrapEnvKey('INSTALLED_VERSION', `v${latestTag}`);
      process.env.INSTALLED_VERSION = `v${latestTag}`;
      await runNpmInstall(true);

      console.log('');
      console.log(SEP);
      console.log(cyan(`[BOTIFY-X] ✅  Update complete — now running v${latestTag}`));
      console.log(SEP);
      console.log('');
      await sleep(2000);

      updatingNow     = false;
      updateScheduled = false;
      launch();
    }

    // ── Schedule the 3-hour deferred update ──────────────────────────────────────
    function scheduleUpdate(latestTag) {
      if (updateScheduled) return;
      updateScheduled = true;
      const THREE_HOURS = 3 * 60 * 60 * 1000;
      console.log(cyan(`[BOTIFY-X] ⏳  Auto-update to v${latestTag} will apply in 3 hours`));
      setTimeout(() => applyUpdate(latestTag), THREE_HOURS);
    }
    
async function runNpmInstall(force = false) {
      const pinoDir = path.join(CORE_DIR, 'node_modules', 'pino');
      if (!force && fs.existsSync(pinoDir)) { console.log(cyan('[BOTIFY-X] Dependencies already installed — skipping.')); return; }
      if (force) console.log(cyan('[BOTIFY-X] Checking for new dependencies…'));
      else console.log(cyan('[BOTIFY-X] Installing dependencies using npm...'));
      await sleep(2000);
      const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      let r = spawnSync(npm, ['install', '--omit=dev'], { cwd: CORE_DIR, stdio: 'inherit', env: process.env });
      if (r.status !== 0) r = spawnSync(npm, ['install', '--production'], { cwd: CORE_DIR, stdio: 'inherit', env: process.env });
      if (r.status !== 0) console.warn(yellow('[BOTIFY-X] ⚠️  npm install had errors — some features may not work.'));
      else { console.log(cyan('[BOTIFY-X] Dependencies ready.')); await sleep(2000); }
    }

// ── Interactive prompt (last-resort fallback) ─────────────────────────────────
// Uses raw fs.readSync on FD 0 — bypasses Node stream events entirely.
function promptSessionIdSync() {
    process.stdout.write(red('\n[BOTIFY-X] SESSION_ID not found in .env file.\n'));
    process.stdout.write(cyan('[BOTIFY-X] Tip: edit the .env file in this folder and add:\n'));
    process.stdout.write(cyan('[BOTIFY-X]   SESSION_ID=BOTIFY-X=<your_session_string>\n\n'));
    process.stdout.write(cyan('[BOTIFY-X] Or paste it here now:\n'));
    process.stdout.write('Paste Session ID \u2192 ');

    while (true) {
        const buf = Buffer.allocUnsafe(4096);
        let n;
        try { n = fs.readSync(0, buf, 0, 4096, null); } catch (_) { n = 0; }
        if (!n) {
            console.error(red('\n[BOTIFY-X] \u274c stdin is not available on this platform.'));
            console.error(cyan('[BOTIFY-X] Edit the .env file next to index.js and add:'));
            console.error(cyan('[BOTIFY-X]   SESSION_ID=BOTIFY-X=<your_session_string>'));
            console.error(cyan('[BOTIFY-X] Then restart.'));
            process.exit(1);
        }

        const id = buf.slice(0, n).toString('utf8').split('\n')[0].trim();

        if (!id) {
            process.stdout.write(red('[BOTIFY-X] Nothing entered. Try again.\n'));
            process.stdout.write('Paste Session ID \u2192 ');
            continue;
        }

        if (!id.startsWith('BOTIFY-X=') && !id.startsWith('MEGA-')) {
            process.stdout.write(red('[BOTIFY-X] \u274c Invalid format. Must start with BOTIFY-X= or MEGA-\n'));
            process.stdout.write('Paste Session ID \u2192 ');
            continue;
        }

        // Save to bootstrap .env so next restart skips this prompt
        writeBootstrapEnvKey('SESSION_ID', id);
        process.env.SESSION_ID = id;
        process.stdout.write(green('[BOTIFY-X] \u2705 Session ID saved to .env — future restarts will skip this prompt.\n\n'));
        return;
    }
}

    let attempts = 0;
    function launch() {
      attempts = 0;
      if (!fs.existsSync(ENTRY)) { console.error(red(`[BOTIFY-X] ❌ Entry not found: ${ENTRY}`)); process.exit(1); }
      currentChild = spawn(process.execPath, [ENTRY], { cwd: CORE_DIR, stdio: 'inherit', env: process.env });
      currentChild.on('exit', (code, signal) => {
          currentChild = null;
          if (updatingNow) return; // killed by applyUpdate — it will call launch() when ready
          if (code === 0 || signal === 'SIGTERM') { console.log(cyan('[BOTIFY-X] Process exited cleanly.')); process.exit(0); }
          attempts++;
          if (attempts >= MAX_RETRIES) { console.error(red(`[BOTIFY-X] Crashed ${attempts} times. Giving up.`)); process.exit(1); }
          const delay = Math.min(RETRY_DELAY * attempts, 60000);
          console.log(red(`[BOTIFY-X] Crashed (code=${code}). Restarting in ${delay / 1000}s…`));
          setTimeout(launch, delay);
      });
      process.once('SIGINT',  () => { if (currentChild) currentChild.kill('SIGINT'); });
      process.once('SIGTERM', () => { if (currentChild) currentChild.kill('SIGTERM'); });
    }

    (async () => {
      const platformName = detectPlatform();
      await banner(platformName);

      // Load .env early so INSTALLED_VERSION + SESSION_ID are visible
      loadEnvFile(BOOTSTRAP_ENV);
      loadEnvFile(CORE_ENV);

      // Restore any leftover backups from a previous failed/interrupted update
      if (fs.existsSync(DB_BAK) || fs.existsSync(ENV_BAK) || fs.existsSync(SES_BAK)) {
          console.log(cyan('[BOTIFY-X] ⚠️  Leftover backup detected — restoring from previous update...'));
          try { restoreSettings(); } catch (e) { console.error(red(`[BOTIFY-X] Restore failed: ${e.message}`)); }
          await sleep(1000);
      }

      // Download Core (first boot) or check for updates (subsequent boots)
      const installed = (process.env.INSTALLED_VERSION || '').replace(/^v/, '');

      if (!fs.existsSync(ENTRY)) {
          // First boot: Core not present locally
          console.log(cyan('[BOTIFY-X] Core not found locally. Downloading...'));
          await sleep(2000);
          let latestFirst = '';
          try { latestFirst = await fetchLatestRelease(); } catch (_) {}
          const ok = await downloadCore();
          if (!ok) { console.error(red('[BOTIFY-X] ❌ All download methods failed.')); process.exit(1); }
          if (latestFirst) {
              writeBootstrapEnvKey('INSTALLED_VERSION', `v${latestFirst}`);
              process.env.INSTALLED_VERSION = `v${latestFirst}`;
          }
          await runNpmInstall();
      } else {
          // Core present: compare installed version vs latest GitHub release
          try {
              const SEP = cyan('[BOTIFY-X] ' + '━'.repeat(40));
              const disp = installed ? `v${installed}` : 'unknown';
              console.log(cyan(`[BOTIFY-X] Checking for updates (installed: ${disp})...`));
              const latest = await fetchLatestRelease();

              if (!latest) {
                  console.log(cyan('[BOTIFY-X] ℹ️  Could not read release info — continuing.'));
              } else if (!installed) {
                  // No record — wipe and re-download to be safe
                  console.log(cyan('[BOTIFY-X] ℹ️  No installed version on record — refreshing Core...'));
                  await sleep(1000);
                  backupSettings();
                  if (fs.existsSync(CORE_DIR)) fs.rmSync(CORE_DIR, { recursive: true, force: true });
                  const ok2 = await downloadCore();
                  if (ok2) {
                      restoreSettings();
                      writeBootstrapEnvKey('INSTALLED_VERSION', `v${latest}`);
                      process.env.INSTALLED_VERSION = `v${latest}`;
                      await runNpmInstall(true);
                  }
              } else if (isNewer(latest, installed)) {
                  console.log('');
                  console.log(SEP);
                  console.log(cyan('[BOTIFY-X] 🔔  NEW VERSION AVAILABLE'));
                  console.log(cyan(`[BOTIFY-X]   Installed : v${installed}`));
                  console.log(cyan(`[BOTIFY-X]   Latest    : v${latest}`));
                  console.log(cyan('[BOTIFY-X]   Auto-update will apply in 3 hours'));
                  console.log(SEP);
                  console.log('');
                  scheduleUpdate(latest);
              } else {
                  console.log(cyan(`[BOTIFY-X] ✅ Up to date (v${installed})`));
              }
          } catch (err) {
              console.error(cyan(`[BOTIFY-X] ⚠️  Update check failed: ${err.message} — continuing.`));
          }
          await runNpmInstall();
      }

      // SESSION_ID
      if (!process.env.SESSION_ID) {
          const isCloudNoConsole = !!(
              process.env.RAILWAY_SERVICE_ID || process.env.RAILWAY_STATIC_URL ||
              process.env.DYNO || process.env.RENDER ||
              process.env.KOYEB_APP_NAME || process.env.FLY_APP_NAME
          );
          if (isCloudNoConsole) {
              console.error(red('[BOTIFY-X] ❌ SESSION_ID is not set.'));
              console.error(cyan('[BOTIFY-X] Set it as an environment variable in your hosting panel.'));
              console.error(cyan('[BOTIFY-X] Format: SESSION_ID=BOTIFY-X=<base64string>'));
              process.exit(1);
          }
          promptSessionIdSync();
      } else {
          console.log(cyan('[BOTIFY-X] ✅ Session ID loaded.'));
          await sleep(2000);
      }

      launch();
    })();
