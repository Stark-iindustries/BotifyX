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

// ── Heroku: bind to PORT immediately to satisfy the 60-second boot timeout ──
// Web dynos are SIGKILL'd if nothing binds to PORT within 60 s.
// The bot doesn't need HTTP — this is a keep-alive shim only.
if (process.env.DYNO) {
    const _port = parseInt(process.env.PORT || '3000', 10);
    http.createServer((_, res) => res.end('BotifyX is running.')).listen(_port, () => {
        console.log('[36m[BOTIFY-X] Heroku port ' + _port + ' bound — boot timeout satisfied.[0m');
    });
}

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

    // ── Read a package.json's dependency names+versions (empty object if missing) ─
    function readDeps(pkgPath) {
      try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          return { ...(pkg.dependencies || {}), ...(pkg.optionalDependencies || {}) };
      } catch (_) { return {}; }
    }

    // ── True if `next` has any package name/version not present in `prev` ────────
    function hasNewOrChangedDeps(prev, next) {
      for (const [name, version] of Object.entries(next)) {
          if (prev[name] !== version) return true;
      }
      return false;
    }

    // ── Move a directory, preferring a fast rename and falling back to a
    // recursive copy+remove if the paths are on different filesystems. ────────────
    function moveDirSync(src, dest) {
      if (!fs.existsSync(src)) return;
      try {
          fs.rmSync(dest, { recursive: true, force: true });
          fs.renameSync(src, dest);
      } catch (_) {
          fs.cpSync(src, dest, { recursive: true, force: true });
          fs.rmSync(src, { recursive: true, force: true });
      }
    }

    // ── Apply deferred update: kill Core -> backup -> wipe -> download -> restore -
    async function applyUpdate(latestTag) {
      if (updatingNow) return;
      updatingNow = true;
      const SEP = cyan('[BOTIFY-X] ' + '━'.repeat(40));
      console.log('');
      console.log(SEP);
      console.log(cyan(`[BOTIFY-X] ⚡  Applying update now → v${latestTag}`));
      console.log(SEP);
      console.log('');
      await sleep(2000);

      if (currentChild) {
          console.log(cyan('[BOTIFY-X] Stopping current Core...'));
          currentChild.kill('SIGTERM');
          await sleep(3000);
      }

      backupSettings();

      // Snapshot the old package.json's deps before we wipe Core, so we can tell
      // afterwards whether the update actually added/changed any dependency.
      const oldPkgPath = path.join(CORE_DIR, 'package.json');
      const prevDeps   = readDeps(oldPkgPath);

      // Preserve node_modules across the wipe — only the source code needs a
      // clean slate, not the already-installed packages. Re-downloading every
      // dependency on every update is slow/unreliable on constrained
      // connections, and is only actually needed when package.json's
      // dependencies changed (checked further below).
      const NM_DIR = path.join(CORE_DIR, 'node_modules');
      const NM_BAK = path.join(BOOTSTRAP_DIR, '.botify-node_modules-backup');
      if (fs.existsSync(NM_DIR)) {
          moveDirSync(NM_DIR, NM_BAK);
          console.log(cyan('[BOTIFY-X] ✓  node_modules preserved'));
      }

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

      if (fs.existsSync(NM_BAK)) {
          moveDirSync(NM_BAK, NM_DIR);
          console.log(cyan('[BOTIFY-X] ✓  node_modules restored'));
      }

      writeBootstrapEnvKey('INSTALLED_VERSION', latestTag);
      process.env.INSTALLED_VERSION = latestTag;

      const newDeps  = readDeps(oldPkgPath);
      const depsChanged = hasNewOrChangedDeps(prevDeps, newDeps);
      const nmMissing    = !fs.existsSync(path.join(CORE_DIR, 'node_modules', 'pino'));
      if (depsChanged || nmMissing) {
          if (depsChanged) console.log(cyan('[BOTIFY-X] New/updated dependencies detected in package.json — installing…'));
          else console.log(cyan('[BOTIFY-X] node_modules missing/incomplete — installing…'));
          await runNpmInstall(true);
      } else {
          console.log(cyan('[BOTIFY-X] No new dependencies in package.json — skipping npm install.'));
      }

      // Brief pause between the "updating" phase and the "success" confirmation.
      await sleep(10000);

      console.log('');
      console.log(SEP);
      console.log(cyan(`[BOTIFY-X] ✅  Update complete — now running v${latestTag}`));
      console.log(SEP);
      console.log('');

      updatingNow     = false;
      updateScheduled = false;
      launch();
    }

    // ── Manual update check, triggered via IPC from Core's `.update` command ────
    async function triggerManualUpdateCheck() {
      const send = (payload) => {
          try { if (currentChild) currentChild.send(payload); } catch (_) {}
      };
      try {
          const installed = process.env.INSTALLED_VERSION || '';
          const latest    = await fetchLatestRelease();
          if (!latest) {
              send({ type: 'updateResult', ok: false, message: 'Could not read latest commit info.' });
              return;
          }
          if (!installed || isNewer(latest, installed)) {
              send({ type: 'updateResult', ok: true, updating: true, latest: latest.slice(0, 7) });
              await applyUpdate(latest);
          } else {
              send({ type: 'updateResult', ok: true, updating: false, latest: latest.slice(0, 7), installed: installed.slice(0, 7) });
          }
      } catch (err) {
          send({ type: 'updateResult', ok: false, message: err.message });
      }
    }
    
async function runNpmInstall(force = false) {
      // On Heroku all Core deps are pre-installed at root during slug compile.
      // Running npm install inside core/ at runtime fails: no git (for the
      // Baileys GitHub tarball) and no build tools (for native modules).
      if (process.env.DYNO) {
          console.log('[36m[BOTIFY-X] Heroku: deps pre-installed at root — skipping core npm install.[0m');
          return;
      }
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

// ── Interactive prompt (removed) ─────────────────────────────────────────────

    let attempts = 0;
    function launch() {
      attempts = 0;
      if (!fs.existsSync(ENTRY)) { console.error(red(`[BOTIFY-X] ❌ Entry not found: ${ENTRY}`)); process.exit(1); }
      currentChild = spawn(process.execPath, [ENTRY], { cwd: CORE_DIR, stdio: ['inherit', 'inherit', 'inherit', 'ipc'], env: process.env });
      currentChild.on('message', (msg) => {
          if (msg && msg.type === 'checkUpdate') {
              triggerManualUpdateCheck().catch(() => {});
          }
      });
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

      // Download Core (first boot) or check for updates (subsequent boots).
      // "Version" here is the installed commit SHA of Core-botifyX's `main`,
      // since that repo has no release tags.
      const installed = process.env.INSTALLED_VERSION || '';

      if (!fs.existsSync(ENTRY)) {
          // First boot: Core not present locally
          console.log(cyan('[BOTIFY-X] Core not found locally. Downloading...'));
          await sleep(2000);
          let latestFirst = '';
          try { latestFirst = await fetchLatestRelease(); } catch (_) {}
          const ok = await downloadCore();
          if (!ok) { console.error(red('[BOTIFY-X] ❌ All download methods failed.')); process.exit(1); }
          if (latestFirst) {
              writeBootstrapEnvKey('INSTALLED_VERSION', latestFirst);
              process.env.INSTALLED_VERSION = latestFirst;
          }
          await runNpmInstall();
      } else {
          // Core present: compare installed commit SHA vs latest commit on main
          try {
              const SEP = cyan('[BOTIFY-X] ' + '━'.repeat(40));
              const disp = installed ? installed.slice(0, 7) : 'unknown';
              console.log(cyan(`[BOTIFY-X] Checking for updates (installed: ${disp})...`));
              const latest = await fetchLatestRelease();

              if (!latest) {
                  console.log(cyan('[BOTIFY-X] ℹ️  Could not read latest commit info — continuing.'));
              } else if (!installed) {
                  // No record — wipe and re-download to be safe
                  console.log(cyan('[BOTIFY-X] ℹ️  No installed version on record — refreshing Core...'));
                  await sleep(1000);
                  backupSettings();
                  if (fs.existsSync(CORE_DIR)) fs.rmSync(CORE_DIR, { recursive: true, force: true });
                  const ok2 = await downloadCore();
                  if (ok2) {
                      restoreSettings();
                      writeBootstrapEnvKey('INSTALLED_VERSION', latest);
                      process.env.INSTALLED_VERSION = latest;
                      await runNpmInstall(true);
                  }
              } else if (isNewer(latest, installed)) {
                  console.log('');
                  console.log(SEP);
                  console.log(cyan('[BOTIFY-X] 🔔  NEW VERSION AVAILABLE'));
                  console.log(cyan(`[BOTIFY-X]   Installed : ${installed.slice(0, 7)}`));
                  console.log(cyan(`[BOTIFY-X]   Latest    : ${latest.slice(0, 7)}`));
                  console.log(cyan('[BOTIFY-X]   Applying update immediately...'));
                  console.log(SEP);
                  console.log('');
                  await applyUpdate(latest);
                  // applyUpdate() already backs up/wipes/downloads/restores,
                  // decides whether npm install is needed, and calls launch()
                  // itself. Falling through here would redundantly re-run
                  // npm install and spawn a second Core process concurrently
                  // with the one applyUpdate() already started — return now.
                  return;
              } else {
                  console.log(cyan(`[BOTIFY-X] ✅ Up to date (${installed.slice(0, 7)})`));
              }
          } catch (err) {
              console.error(cyan(`[BOTIFY-X] ⚠️  Update check failed: ${err.message} — continuing.`));
          }
          await runNpmInstall();
      }

      // SESSION_ID: intentionally NOT checked/prompted here. Core (index.js's
      // child process) already does DB connect + migration + plugin/command
      // loading BEFORE it checks for SESSION_ID and prompts if missing — so the
      // console prompt only ever appears once the bot has finished loading
      // everything else. Prompting here (before Core is even spawned) would
      // show the prompt with nothing loaded yet, which is the bug we're fixing.
      launch();

      // ── Poll GitHub every 10 min — auto-update when a new release is tagged ──
      setInterval(async () => {
          if (updatingNow) return;
          try {
              const latest    = await fetchLatestRelease();
              const installed = process.env.INSTALLED_VERSION || '';
              if (latest && isNewer(latest, installed)) {
                  console.log(cyan('[BOTIFY-X] 🔔 New release detected: ' + latest + ' — updating now...'));
                  await applyUpdate(latest);
              }
          } catch (_) {}
      }, 10 * 60 * 1000);
    })();



