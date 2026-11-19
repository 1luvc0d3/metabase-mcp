#!/usr/bin/env node
// Records the demo video: one terminal take per scenario (VHS driving a real, interactive
// Claude Code session), a browser take of Metabase where a scenario asks for one (Playwright),
// title cards, and a final MP4 assembled with ffmpeg.
//
//   npm run demo:verify -- --model sonnet     # make sure the scenes work with this model first
//   npm run demo:record                       # Sonnet by default
//   npm run demo:record -- --only workflow    # re-take one scene, then re-assemble
//   npm run demo:record -- --assemble         # only rebuild the final video from existing clips
//   npm run demo:record -- --retrim           # re-cut the existing raw takes, then re-assemble
//
// Needs vhs (with ttyd) and ffmpeg on PATH, and Playwright's Chromium (`npx playwright install
// chromium`). Uses your Claude Code login. The terminal shows only the demo MCP server: Claude
// runs from an empty stage folder with --setting-sources '' and --strict-mcp-config. Claude Code's
// startup banner stays on screen (version, model, plan name, stage path).
//
// Output: demo/.out/clips/*.mp4 and demo/.out/metabase-mcp-demo.mp4. Every take is a live model
// run, so watch the result before publishing and re-take any scene that went sideways.

import { chmodSync, existsSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { scenarios } from './scenarios.mjs';
import { claudeArgs, ensureDir, loadState, outDir, parseArgs, run, stageDir, writePrivate } from './lib.mjs';

const opts = parseArgs(process.argv.slice(2));
const model = opts.model || process.env.DEMO_RECORD_MODEL || 'sonnet';
const only = opts.only ? String(opts.only).split(',') : null;
const W = 1920;
const H = 1080;
const FPS = 30;
const clipsDir = ensureDir(join(outDir, 'clips'));
const workDir = ensureDir(join(outDir, 'work'));
const binDir = ensureDir(join(outDir, 'bin'));

const INTRO = {
  id: '00-intro',
  title: 'metabase-mcp',
  caption: 'Ask Metabase questions in Claude, with guardrails',
  seconds: 3.5,
};
const OUTRO = {
  id: '99-outro',
  title: 'claude mcp add metabase -- npx -y @ai-1luvc0d3/metabase-mcp',
  caption: 'github.com/1luvc0d3/metabase-mcp',
  seconds: 4,
  mono: true,
};

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** Launcher a tape can call: clean environment, empty stage folder, isolated Claude flags. */
function writeLauncher(profile) {
  const path = join(binDir, `claude-${profile}.sh`);
  // --verbose expands each tool call, so the SQL and the server's response are on screen.
  const args = [...claudeArgs(profile, model), '--permission-mode', 'default', '--verbose'];
  writePrivate(
    path,
    [
      '#!/usr/bin/env bash',
      '# Drop markers inherited from a parent Claude Code session (they add warnings to the footer).',
      "for v in $(compgen -e | grep -E '^(CLAUDECODE|CLAUDE_CODE_)'); do unset \"$v\"; done",
      `cd ${shq(stageDir)} || exit 1`,
      `exec claude ${args.map(shq).join(' ')}`,
      '',
    ].join('\n'),
  );
  chmodSync(path, 0o700); // writePrivate sets 0600; the launcher must be executable
  return path;
}

/** Claude Code asks once per folder whether to trust it. Accept it off camera if needed. */
async function ensureTrusted(launcher) {
  const configPath = join(homedir(), '.claude.json');
  const key = realpathSync(ensureDir(stageDir));
  const trusted = () => {
    try {
      return JSON.parse(readFileSync(configPath, 'utf8')).projects?.[key]?.hasTrustDialogAccepted === true;
    } catch {
      return false;
    }
  };
  if (trusted()) return;
  console.log(`Accepting the folder-trust prompt for ${key} (one time)…`);
  const tape = join(workDir, 'trust.tape');
  writeFileSync(
    tape,
    [
      `Output "${join(workDir, 'trust.gif')}"`,
      'Set Shell "bash"',
      `Type "${launcher}"`,
      'Enter',
      'Wait+Screen@60s /trust this folder/',
      'Sleep 1s',
      'Down',
      'Sleep 500ms',
      'Enter',
      'Sleep 8s',
      'Ctrl+C',
      'Sleep 500ms',
      'Ctrl+C',
      'Sleep 1s',
      '',
    ].join('\n'),
  );
  await run('vhs', [tape], { stdio: ['ignore', 'ignore', 'inherit'] });
  if (!trusted()) throw new Error(`Could not accept the trust prompt for ${key}; run the launcher once by hand: ${launcher}`);
}

/** VHS tape for one scenario. The prompt is typed on camera; startup and teardown are hidden. */
function tapeFor(scenario, launcher, clip) {
  if (scenario.prompt.includes('`')) throw new Error(`${scenario.id}: prompts can't contain backticks`);
  return [
    `Output "${clip}"`,
    'Set Shell "bash"',
    `Set Width ${W}`,
    `Set Height ${H}`,
    'Set FontSize 26',
    'Set Padding 48',
    'Set WindowBar Colorful',
    'Set TypingSpeed 35ms',
    'Set CursorBlink false',
    `Set Framerate ${FPS}`,
    'Hide',
    // `clear` wipes the typed command line (it holds the launcher's absolute path) before
    // Claude Code draws its first frame.
    `Type "clear; exec ${launcher}"`,
    'Enter',
    // Idle prompt footer: Claude Code is ready for input.
    'Wait+Screen@90s /for shortcuts/',
    'Sleep 1s',
    'Show',
    'Sleep 1s',
    `Type \`${scenario.prompt}\``,
    'Sleep 1s',
    'Enter',
    // VHS 0.12's Wait can't see text once the output scrolls, so give Claude a fixed window and
    // trim the idle tail afterwards (trimIdleTail). Raise a scenario's maxSeconds if it's slow.
    `Sleep ${scenario.maxSeconds ?? 90}s`,
    'Hide',
    'Ctrl+C',
    'Sleep 300ms',
    'Ctrl+C',
    'Sleep 1s',
    '',
  ].join('\n');
}

async function recordTerminal(scenario) {
  const launcher = writeLauncher(scenario.profile);
  await ensureTrusted(launcher);
  const state = loadState();
  if (scenario.before) await scenario.before(state);
  const raw = join(workDir, `${scenario.id}-raw.mp4`);
  const tape = join(workDir, `${scenario.id}.tape`);
  writeFileSync(tape, tapeFor(scenario, launcher, raw));
  console.log(`● ${scenario.id}: recording terminal take with ${model} (up to ${scenario.maxSeconds ?? 90}s)…`);
  await run('vhs', [tape], { stdio: ['ignore', 'ignore', 'pipe'] });
  return trimIdleTail(raw, join(clipsDir, `${scenario.order}-${scenario.id}-1term.mp4`), scenario);
}

/**
 * Cut the take shortly after Claude finished: find the last frame that visibly differs from the
 * one before it (mpdecimate drops near-duplicates; the thresholds ignore compression noise) and
 * keep 4 seconds after it. While Claude works the spinner keeps changing the screen, so the last
 * change is the "done" line.
 */
async function trimIdleTail(raw, clip, scenario) {
  const log = await run(
    'ffmpeg',
    ['-hide_banner', '-i', raw, '-vf', 'mpdecimate=hi=64*40:lo=64*20:frac=0.0002,showinfo', '-an', '-f', 'null', '-'],
    { stdio: ['ignore', 'ignore', 'pipe'], mergeStderr: true },
  );
  const changes = [...log.matchAll(/pts_time:([0-9.]+)/g)].map((m) => Number(m[1]));
  const duration = Number(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', raw]));
  const lastChange = changes.length ? changes[changes.length - 1] : duration;
  if (lastChange > duration - 5) {
    console.warn(`  ${scenario.id}: Claude may still have been working when the take ended; raise maxSeconds in scenarios.mjs`);
  }
  const keep = Math.min(duration, lastChange + 4);
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-t', keep.toFixed(2), ...encodeArgs(), clip]);
  console.log(`  ${scenario.id}: ${keep.toFixed(0)}s kept of ${duration.toFixed(0)}s`);
  return clip;
}

async function launchBrowser() {
  const { chromium } = await import('playwright');
  return chromium.launch();
}

/** Record a Metabase page, logged in with the demo admin session. */
async function recordBrowser(scenario, browser) {
  const state = loadState();
  const path = await scenario.browserShot(state);
  if (!path) {
    console.warn(`  ${scenario.id}: nothing to show in the browser, skipping`);
    return null;
  }
  console.log(`● ${scenario.id}: recording Metabase ${path}…`);
  const videoDir = ensureDir(join(workDir, `browser-${scenario.id}`));
  rmSync(videoDir, { recursive: true, force: true });
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: videoDir, size: { width: W, height: H } },
  });
  const { hostname } = new URL(state.metabaseUrl);
  await context.addCookies([{ name: 'metabase.SESSION', value: state.session, domain: hostname, path: '/', httpOnly: true }]);
  const page = await context.newPage();
  await page.goto(`${state.metabaseUrl}${path}`, { waitUntil: 'networkidle' });
  // Let the chart draw, then hold on it.
  await page.waitForTimeout(6000);
  // Zoom onto the first dashboard card (plus the dashboard title above it): on a 1080p page a
  // single card is a small tile surrounded by empty space.
  const card = await page.locator('.react-grid-item').first().boundingBox().catch(() => null);
  const video = page.video();
  await context.close();
  const webm = await video.path();
  const clip = join(clipsDir, `${scenario.order}-${scenario.id}-2browser.mp4`);
  const pre = [];
  if (card) {
    const pad = 40;
    const x = Math.max(0, Math.floor(card.x - pad));
    const y = Math.max(0, Math.floor(card.y - 110)); // include the dashboard title
    const w = Math.min(W - x, Math.ceil(card.width + 2 * pad));
    const h = Math.min(H - y, Math.ceil(card.y + card.height + pad - y));
    pre.push(`crop=${w - (w % 2)}:${h - (h % 2)}:${x}:${y}`);
  }
  // Trim the blank first second of page load.
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '1', '-i', webm, ...encodeArgs(pre), clip]);
  return clip;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** Title card rendered as HTML (ffmpeg builds often lack drawtext), held as a still clip. */
async function titleCard(card, browser) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  await page.setContent(`<!doctype html><html><body style="margin:0;width:${W}px;height:${H}px;display:flex;
    flex-direction:column;justify-content:center;align-items:center;background:#16161e;color:#f4f4f5;
    font-family:-apple-system,'Segoe UI',Inter,Helvetica,Arial,sans-serif;text-align:center">
    ${card.kicker ? `<div style="font-size:30px;letter-spacing:.12em;text-transform:uppercase;color:#a78bfa;margin-bottom:28px">${esc(card.kicker)}</div>` : ''}
    ${card.title ? `<div style="font-size:${card.mono ? 46 : 92}px;font-weight:700;${card.mono ? 'font-family:ui-monospace,Menlo,monospace;background:#26263a;padding:28px 44px;border-radius:14px' : ''}">${esc(card.title)}</div>` : ''}
    <div style="font-size:40px;color:#a1a1aa;margin-top:36px;max-width:1500px;line-height:1.35">${esc(card.caption)}</div>
  </body></html>`);
  const png = join(workDir, `${card.id}.png`);
  await page.screenshot({ path: png });
  await page.close();
  const clip = join(clipsDir, `${card.id}.mp4`);
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-t', String(card.seconds ?? 2.5), '-i', png, ...encodeArgs(), clip]);
  return clip;
}

function encodeArgs(pre = []) {
  return [
    '-vf', `${pre.map((f) => `${f},`).join('')}scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=#16161e,fps=${FPS},format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-an',
  ];
}

/** Join every clip in name order into the final video. */
async function assemble() {
  const clips = readdirSync(clipsDir).filter((f) => f.endsWith('.mp4')).sort();
  if (clips.length === 0) throw new Error('No clips to assemble');
  // Re-encode everything to one format so the concat demuxer can join them without glitches.
  const normDir = ensureDir(join(workDir, 'norm'));
  const list = [];
  for (const f of clips) {
    const norm = join(normDir, f);
    await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(clipsDir, f), ...encodeArgs(), norm]);
    list.push(`file '${norm.replace(/'/g, `'\\''`)}'`);
  }
  const listPath = join(workDir, 'concat.txt');
  writeFileSync(listPath, list.join('\n') + '\n');
  const out = join(outDir, 'metabase-mcp-demo.mp4');
  await run('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart', out]);
  const secs = Number(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]));
  console.log(`\n✔ ${out}  (${clips.length} clips, ${secs.toFixed(0)}s)`);
  return out;
}

async function main() {
  for (const tool of ['vhs', 'ttyd', 'ffmpeg', 'ffprobe']) {
    await run('sh', ['-c', `command -v ${tool}`]).catch(() => {
      throw new Error(`${tool} not found on PATH (macOS: brew install vhs ffmpeg)`);
    });
  }
  loadState();

  if (!opts.assemble) {
    const browser = await launchBrowser();
    try {
      const numbered = scenarios.map((s, i) => ({ ...s, order: String((i + 1) * 10).padStart(2, '0') }));
      if (!only) {
        await titleCard(INTRO, browser);
        await titleCard(OUTRO, browser);
      }
      for (const s of numbered.filter((x) => !only || only.includes(x.id))) {
        await titleCard({ id: `${s.order}-${s.id}-0card`, kicker: s.title, caption: s.caption, seconds: 2.5 }, browser);
        const raw = join(workDir, `${s.id}-raw.mp4`);
        if (opts.retrim && existsSync(raw)) {
          await trimIdleTail(raw, join(clipsDir, `${s.order}-${s.id}-1term.mp4`), s);
        } else if (!opts['skip-terminal']) {
          await recordTerminal(s);
        }
        if (opts.retrim) continue;
        if (s.browserShot && !opts['skip-browser']) await recordBrowser(s, browser);
      }
    } finally {
      await browser.close();
    }
  }
  await assemble();
  if (!existsSync(join(outDir, 'verify-report.md'))) {
    console.warn('No verify report found: run `npm run demo:verify` so you know each scene works before publishing.');
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
