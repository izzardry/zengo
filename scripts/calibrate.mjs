#!/usr/bin/env node
/**
 * Calibration ladder (DESIGN 10.2, 15.4): Zengo's computer levels against GNU Go 3.8 in Node, to fit
 * the approximate ranks the start screen may show (`src/lib/ranks.json`). Logged, not blocking.
 *
 *   node scripts/calibrate.mjs [--levels 1,3,5,7] [--games 2] [--size 9] [--rules area]
 *                              [--gnugo-level 10] [--seed 1] [--anchor 6] [--min-games 10]
 *                              [--max-minutes 30] [--write] [--backend wasm|cpu]
 *
 * GNU Go is the calibration anchor KaTrain used for its rank bot. It runs from the GPL-3.0 WASM
 * build of marinahane/gnugo-wasm (release v2), which this script downloads into
 * ~/.cache/zengo/gnugo-wasm-v2/ on first use. It is a development tool only: never copied into the
 * repository, never shipped (DESIGN 15.2: nothing GPL ships).
 *
 * Each GNU Go move runs a fresh GNU Go instance (its `callMain` runs once per instance) that replays
 * the game as GTP `play` commands and answers `genmove`. Zengo plays with its own engine and level
 * rules, exactly as `scripts/selfplay.mjs` does. Colors alternate. A game ends by resignation, by two
 * passes (area count with the engine's dead-stone proposal), or after three plies per point (the
 * engine's score estimate decides). GNU Go answers that Zengo's rules forbid (positional superko)
 * count as a pass.
 *
 * Output: per level the games, wins and win rate against GNU Go, and a rank estimate. The estimate
 * assumes GNU Go level `--gnugo-level` is `--anchor` kyu on this board (default 6k: research gives
 * 5–7k on 9×9) and moves one kyu per 7 percentage points of win rate away from 50 % (a coarse
 * logistic slope; KaTrain fitted its own). A level gets a rank only with at least `--min-games`
 * games and a win rate strictly between 10 % and 90 %; otherwise it is reported as below or above
 * the anchor. With `--write` the ranks are written to src/lib/ranks.json, but only when at least two
 * levels got a rank; the script says when that is not the case.
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createNodeEngine } from '../src/lib/engine/node.ts';
import { avoidFor, levelSpec, nextSeed, openDame, pickMove, resignDecision, seededRng } from '../src/lib/levels.ts';
import { PASS, fromGtp, gtp, isLegal, isPass, makeSettings, newGame, pass, play, position } from '../src/lib/zengo.ts';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const levels = String(arg('levels', '1,3,5,7'))
  .split(',')
  .map(Number)
  .filter((n) => n >= 1 && n <= 12);
const gamesPerLevel = Number(arg('games', 2));
const size = Number(arg('size', 9));
const rules = arg('rules', 'area') === 'territory' ? 'territory' : 'area';
const gnugoLevel = Number(arg('gnugo-level', 10));
const seed = Number(arg('seed', 1));
const anchor = Number(arg('anchor', 6));
const minGames = Number(arg('min-games', 10));
const maxMinutes = Number(arg('max-minutes', 30));
const write = !!arg('write', false);
const backend = arg('backend', 'wasm') === 'cpu' ? 'cpu' : 'wasm';

const RELEASE = 'https://github.com/marinahane/gnugo-wasm/releases/download/v2';
const FILES = { 'gnugo.mjs': 81401, 'gnugo.wasm': 6159472, LICENSE: 35147 };
const CACHE = join(homedir(), '.cache', 'zengo', 'gnugo-wasm-v2');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Downloads GNU Go WASM into the cache (once), checking each file's size. */
async function ensureGnuGo() {
  await mkdir(CACHE, { recursive: true });
  for (const [name, bytes] of Object.entries(FILES)) {
    const path = join(CACHE, name);
    if (existsSync(path) && (await readFile(path)).length === bytes) continue;
    console.log(`Downloading ${name} from ${RELEASE} …`);
    const res = await fetch(`${RELEASE}/${name}`);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length !== bytes) throw new Error(`${name}: expected ${bytes} bytes, got ${buf.length}`);
    await writeFile(path, buf);
  }
}

await ensureGnuGo();
const { default: createGnuGo } = await import(pathToFileURL(join(CACHE, 'gnugo.mjs')).href);
const wasmModule = await WebAssembly.compile(await readFile(join(CACHE, 'gnugo.wasm')));

/** Runs one GNU Go process over `commands` (GTP lines) and returns its responses. */
async function gnugoRun(commands, gnugoSeed) {
  const input = new TextEncoder().encode(commands.join('\n') + '\n');
  let pos = 0;
  const out = [];
  const mod = await createGnuGo({
    instantiateWasm(imports, receive) {
      WebAssembly.instantiate(wasmModule, imports).then((inst) => receive(inst));
      return {};
    },
    stdin: () => (pos < input.length ? input[pos++] : null),
    stdout: (b) => out.push(b),
    stderr: () => undefined,
  });
  const args = ['--mode', 'gtp', '--level', String(gnugoLevel), '--seed', String(gnugoSeed)];
  if (rules === 'area') args.push('--chinese-rules');
  mod.callMain(args);
  return new TextDecoder()
    .decode(new Uint8Array(out))
    .split(/\n\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** GNU Go's move for the side to move in `g`. */
async function gnugoMove(g, gnugoSeed) {
  const cmds = [`boardsize ${size}`, 'clear_board', `komi ${g.settings.komi2 / 2}`];
  for (let i = 0; i < g.cursor; i++) {
    const color = i % 2 === 0 ? 'B' : 'W';
    cmds.push(`play ${color} ${isPass(g.plies[i].m) ? 'pass' : gtp(g.plies[i].m, size)}`);
  }
  cmds.push(`genmove ${g.turn}`);
  const replies = await gnugoRun(cmds, gnugoSeed);
  const bad = replies.find((r) => r.startsWith('?'));
  if (bad) console.warn(`  GNU Go refused a command: ${bad}`);
  const last = replies[replies.length - 1] ?? '';
  const text = last.replace(/^=\s*/, '').trim().toLowerCase();
  if (text === 'resign') return 'resign';
  if (text === 'pass' || text === '') return PASS;
  const p = fromGtp(text, size);
  if (!p || !isLegal(g, p)) {
    console.warn(`  GNU Go answered ${text}, not legal under Zengo's rules: counted as a pass`);
    return PASS;
  }
  return p;
}

/** Area count after removing stones the engine sees as dead. */
function areaCount(board, n, ownership) {
  const b = Uint8Array.from(board);
  for (let i = 0; i < n * n; i++) if ((b[i] === 1 && ownership[i] <= -0.7) || (b[i] === 2 && ownership[i] >= 0.7)) b[i] = 0;
  const count = { B: 0, W: 0 };
  const seen = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) {
    if (b[i] === 1) count.B++;
    else if (b[i] === 2) count.W++;
    else if (!seen[i]) {
      const stack = [i];
      seen[i] = 1;
      let cells = 0;
      let tb = false;
      let tw = false;
      while (stack.length) {
        const j = stack.pop();
        cells++;
        const x = j % n;
        for (const k of [x > 0 ? j - 1 : -1, x < n - 1 ? j + 1 : -1, j >= n ? j - n : -1, j < n * n - n ? j + n : -1]) {
          if (k < 0) continue;
          if (b[k] === 1) tb = true;
          else if (b[k] === 2) tw = true;
          else if (!seen[k]) {
            seen[k] = 1;
            stack.push(k);
          }
        }
      }
      if (tb && !tw) count.B += cells;
      else if (tw && !tb) count.W += cells;
    }
  }
  return count;
}

const engine = await createNodeEngine({ backend });
const rng = seededRng(seed);
const started = Date.now();
const deadline = started + maxMinutes * 60_000;
const table = [];
const timing = { zengo: { ms: 0, moves: 0 }, gnugo: { ms: 0, moves: 0 } };
console.log(
  `Calibration on ${size}×${size} (${rules}): levels ${levels.join(', ')} × ${gamesPerLevel} game(s) against GNU Go level ${gnugoLevel}; backend ${engine.backend}`,
);

let gameNo = 0;
outer: for (const level of levels) {
  const row = { level, name: levelSpec(level).name, games: 0, wins: 0, results: [] };
  table.push(row);
  for (let n = 0; n < gamesPerLevel; n++) {
    if (Date.now() > deadline) {
      console.log(`Time cap of ${maxMinutes} minutes reached; stopping.`);
      break outer;
    }
    gameNo++;
    const zengoColor = n % 2 === 0 ? 'B' : 'W';
    let g = newGame(makeSettings(size, rules, 0));
    const views = [];
    let result = null;
    const t0 = Date.now();
    while (!g.scoring && g.cursor < size * size * 3) {
      const ts = Date.now();
      if (g.turn === zengoColor) {
        const pos = position(g);
        const res = await engine.genmove(pos, level, undefined, { avoid: avoidFor(g, level), seed: nextSeed(rng) });
        views.push({ winrate: res.winrate, scoreLead: res.scoreLead });
        if (resignDecision(level, size, g.cursor, views)) {
          result = { winner: zengoColor === 'B' ? 'W' : 'B', by: 'resign' };
          break;
        }
        let move = pickMove(g, level, res, rng).move;
        if (isPass(move) && rules === 'area') {
          const e = await engine.evaluate(pos, {});
          const dame = openDame(g, e.ownership);
          if (dame.length > 0) move = dame[0];
        }
        g = isPass(move) ? pass(g, 0) : play(g, move, 0);
        timing.zengo.ms += Date.now() - ts;
        timing.zengo.moves++;
      } else {
        const move = await gnugoMove(g, seed * 1000 + gameNo * 7 + g.cursor);
        timing.gnugo.ms += Date.now() - ts;
        timing.gnugo.moves++;
        if (move === 'resign') {
          result = { winner: zengoColor, by: 'resign' };
          break;
        }
        g = isPass(move) ? pass(g, 0) : play(g, move, 0);
      }
    }
    if (!result) {
      const pos = position(g);
      const e = await engine.evaluate(pos, { visits: 100, timeMs: 5000 });
      if (g.scoring) {
        const c = areaCount(g.board, size, e.ownership);
        const margin = c.B - c.W - g.settings.komi2 / 2;
        result = { winner: margin > 0 ? 'B' : 'W', by: 'score', margin: Math.abs(margin) };
      } else {
        const lead = pos.turn === 'B' ? e.scoreLead : -e.scoreLead;
        result = { winner: lead > 0 ? 'B' : 'W', by: 'estimate', margin: Math.abs(Math.round(lead * 10) / 10) };
      }
    }
    const won = result.winner === zengoColor;
    row.games++;
    if (won) row.wins++;
    const text = result.by === 'resign' ? `${result.winner}+R` : `${result.winner}+${result.margin}${result.by === 'estimate' ? ' (estimate)' : ''}`;
    row.results.push(text);
    console.log(
      `  level ${level} as ${zengoColor === 'B' ? 'Black' : 'White'}: ${text} after ${g.cursor} plies, ${((Date.now() - t0) / 1000).toFixed(0)} s → ${won ? 'Zengo won' : 'GNU Go won'}`,
    );
  }
}
await engine.dispose();

/** Rank estimate in kyu (negative = dan), or null when the sample says too little. */
function estimate(row) {
  if (row.games < minGames) return null;
  const rate = row.wins / row.games;
  if (rate <= 0.1 || rate >= 0.9) return null;
  return Math.round(anchor - (rate - 0.5) / 0.07);
}
const fmtRank = (k) => (k > 0 ? `${k}k` : `${1 - k}d`);

console.log(`\nGNU Go level ${gnugoLevel} taken as ≈${fmtRank(anchor)} on ${size}×${size}.`);
console.log('level  name        games  wins  win rate  rank');
const ranks = {};
for (const row of table) {
  const rate = row.games ? row.wins / row.games : 0;
  const k = estimate(row);
  const rank =
    k !== null
      ? `≈${fmtRank(k)}`
      : row.games < minGames
        ? `too few games (< ${minGames})`
        : rate <= 0.1
          ? `below ${fmtRank(anchor)}`
          : `above ${fmtRank(anchor)}`;
  if (k !== null) ranks[row.level] = fmtRank(k);
  console.log(
    `${String(row.level).padEnd(6)} ${row.name.padEnd(11)} ${String(row.games).padEnd(6)} ${String(row.wins).padEnd(5)} ${(rate * 100).toFixed(0).padStart(3)} %     ${rank}   [${row.results.join(', ')}]`,
  );
}
console.log(
  `\nTime per move: Zengo ${(timing.zengo.ms / Math.max(1, timing.zengo.moves)).toFixed(0)} ms, GNU Go ${(timing.gnugo.ms / Math.max(1, timing.gnugo.moves)).toFixed(0)} ms; total ${((Date.now() - started) / 60000).toFixed(1)} min.`,
);

if (Object.keys(ranks).length >= 2) {
  const json = { anchor: `GNU Go 3.8 level ${gnugoLevel} ≈ ${fmtRank(anchor)}`, size, rules, ranks };
  console.log(`\nRanks: ${JSON.stringify(ranks)}`);
  if (write) {
    await writeFile(join(ROOT, 'src/lib/ranks.json'), JSON.stringify(json, null, 2) + '\n');
    console.log('Written to src/lib/ranks.json.');
  }
} else {
  console.log('\nNot enough evidence for a ranks table (fewer than two levels with a rank); src/lib/ranks.json not written.');
}
