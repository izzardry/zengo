#!/usr/bin/env node
/**
 * Self-play in Node: a strong level against a weak one with the real engine (Gate 2 and DESIGN 15.4:
 * level 12 should beat level 1 on 9×9 and 19×19; logged, not blocking).
 *
 *   node scripts/selfplay.mjs [--strong 12] [--weak 1] [--size 9] [--rules area] [--games 1]
 *                             [--seed 1] [--strong-black] [--max-plies N] [--backend wasm|cpu] [--quiet]
 *
 * It runs the app's own engine (src/lib/engine/node.ts, the KataGo networks in public/engine/nets)
 * and the app's own level rules (src/lib/levels.ts: avoid big self-ataris, level 1's humanizing,
 * open dame before a pass, resigning), loaded by Node's type stripping (Node 23.6+, no build). One
 * engine plays both sides; searches run one at a time. Colors alternate between games unless
 * `--strong-black` fixes them.
 *
 * A game ends by resignation (DESIGN 10.4), by two passes (counted by area with the engine's
 * dead-stone proposal, as the app's scoring phase would propose it), or at `--max-plies` (default
 * three plies per board point; then the engine's score lead decides). Prints each game's moves in
 * GTP coordinates, the result, the time per move by level, and a summary. Exits 0 when the strong
 * level won every game, 1 otherwise.
 */
import { createNodeEngine } from '../src/lib/engine/node.ts';
import {
  avoidFor,
  levelSpec,
  nextSeed,
  openDame,
  pickMove,
  resignDecision,
  seededRng,
} from '../src/lib/levels.ts';
import { PASS, gtp, isPass, makeSettings, newGame, pass, play, position } from '../src/lib/zengo.ts';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

const strong = Number(arg('strong', 12));
const weak = Number(arg('weak', 1));
const size = Number(arg('size', 9));
const rules = arg('rules', 'area') === 'territory' ? 'territory' : 'area';
const games = Number(arg('games', 1));
const seed = Number(arg('seed', 1));
const fixedBlack = !!arg('strong-black', false);
const maxPlies = Number(arg('max-plies', size * size * 3));
const backend = arg('backend', 'wasm') === 'cpu' ? 'cpu' : 'wasm';
const quiet = !!arg('quiet', false);

if (![9, 13, 19].includes(size)) {
  console.error('--size must be 9, 13 or 19');
  process.exit(2);
}

/** Area count of a finished position: dead stones (ownership ≥ 0.7 toward the opponent) removed, then stones + surrounded empty points. */
function areaCount(board, n, ownership) {
  const b = Uint8Array.from(board);
  for (let i = 0; i < n * n; i++) {
    if ((b[i] === 1 && ownership[i] <= -0.7) || (b[i] === 2 && ownership[i] >= 0.7)) b[i] = 0;
  }
  const count = { B: 0, W: 0 };
  const seen = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) {
    if (b[i] === 1) count.B++;
    else if (b[i] === 2) count.W++;
    else if (!seen[i]) {
      const stack = [i];
      seen[i] = 1;
      let size = 0;
      let touchB = false;
      let touchW = false;
      while (stack.length) {
        const j = stack.pop();
        size++;
        const x = j % n;
        const nb = [x > 0 ? j - 1 : -1, x < n - 1 ? j + 1 : -1, j >= n ? j - n : -1, j < n * n - n ? j + n : -1];
        for (const k of nb) {
          if (k < 0) continue;
          if (b[k] === 1) touchB = true;
          else if (b[k] === 2) touchW = true;
          else if (!seen[k]) {
            seen[k] = 1;
            stack.push(k);
          }
        }
      }
      if (touchB && !touchW) count.B += size;
      else if (touchW && !touchB) count.W += size;
    }
  }
  return count;
}

const engine = await createNodeEngine({ backend });
const rng = seededRng(seed);
const timing = new Map(); // level → { ms, moves }
const results = [];
const started = Date.now();
console.log(
  `Self-play on ${size}×${size} (${rules}), level ${strong} ${levelSpec(strong).name} vs level ${weak} ${levelSpec(weak).name}, ` +
    `${games} game(s), seed ${seed}, backend ${engine.backend}`,
);

for (let n = 0; n < games; n++) {
  const strongColor = fixedBlack || n % 2 === 0 ? 'B' : 'W';
  const levels = strongColor === 'B' ? { B: strong, W: weak } : { B: weak, W: strong };
  let g = newGame(makeSettings(size, rules, 0));
  const views = { B: [], W: [] };
  const line = [];
  let result = null;
  const t0 = Date.now();
  while (!g.scoring && g.cursor < maxPlies) {
    const color = g.turn;
    const level = levels[color];
    const pos = position(g);
    const ts = Date.now();
    const res = await engine.genmove(pos, level, undefined, { avoid: avoidFor(g, level), seed: nextSeed(rng) });
    views[color].push({ winrate: res.winrate, scoreLead: res.scoreLead });
    if (resignDecision(level, size, g.cursor, views[color])) {
      result = { winner: color === 'B' ? 'W' : 'B', by: 'resign' };
      line.push(`${color === 'B' ? 'B' : 'W'} resigns`);
      break;
    }
    let move = pickMove(g, level, res, rng).move;
    if (isPass(move) && rules === 'area') {
      const e = await engine.evaluate(pos, {});
      const dame = openDame(g, e.ownership);
      if (dame.length > 0) move = dame[0];
    }
    const ms = Date.now() - ts;
    const tm = timing.get(level) ?? { ms: 0, moves: 0 };
    timing.set(level, { ms: tm.ms + ms, moves: tm.moves + 1 });
    g = isPass(move) ? pass(g, ms) : play(g, move, ms);
    line.push(gtp(move, size));
  }
  let margin = null;
  if (!result) {
    const pos = position(g);
    const e = await engine.evaluate(pos, { visits: 100, timeMs: 5000 });
    if (g.scoring) {
      const c = areaCount(g.board, size, e.ownership);
      margin = c.B - c.W - g.settings.komi2 / 2;
      result = { winner: margin > 0 ? 'B' : 'W', by: 'score', margin: Math.abs(margin), count: c };
    } else {
      // Cut at --max-plies: the engine's estimate decides (from Black's view).
      const lead = pos.turn === 'B' ? e.scoreLead : -e.scoreLead;
      result = { winner: lead > 0 ? 'B' : 'W', by: 'estimate', margin: Math.abs(Math.round(lead * 10) / 10) };
    }
  }
  const strongWon = result.winner === strongColor;
  results.push({ strongWon, result, plies: g.cursor, secs: (Date.now() - t0) / 1000, strongColor });
  const res =
    result.by === 'resign'
      ? `${result.winner}+R`
      : result.by === 'score'
        ? `${result.winner}+${result.margin} (B ${result.count.B}, W ${result.count.W} + ${g.settings.komi2 / 2})`
        : `${result.winner}+${result.margin} (estimate after ${g.cursor} plies)`;
  console.log(`\nGame ${n + 1}: level ${strong} plays ${strongColor === 'B' ? 'Black' : 'White'}`);
  if (!quiet) console.log(line.join(' '));
  console.log(`Result: ${res} after ${g.cursor} plies in ${((Date.now() - t0) / 1000).toFixed(1)} s; level ${strong} ${strongWon ? 'won' : 'lost'}`);
}

await engine.dispose();
console.log('\nTime per move:');
for (const [level, t] of [...timing.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  level ${level}: ${(t.ms / t.moves).toFixed(0)} ms over ${t.moves} moves`);
}
const won = results.filter((r) => r.strongWon).length;
console.log(`\nLevel ${strong} won ${won} of ${results.length} on ${size}×${size} in ${((Date.now() - started) / 1000).toFixed(0)} s.`);
console.log(won === results.length ? `PASS: level ${strong} beat level ${weak}` : `FAIL: level ${strong} lost ${results.length - won} game(s)`);
process.exit(won === results.length ? 0 : 1);
