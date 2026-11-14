/**
 * The WebGPU check (DESIGN 10.1): a fixed position, evaluated on WASM and on WebGPU, must give the
 * same answer before WebGPU is used for a board size and network (EngineDriver's warm-up).
 */
import type { EngineEvaluation, Position, Size } from '../types.ts';
import { newGame, play, position } from '../zengo.ts';

/** A small opening position (on any board size) every device evaluates the same way. */
export function probePosition(size: Size = 9): Position {
  let g = newGame({ size, rules: 'area', handicap: 0, komi2: 15 });
  for (const m of ['cc', 'gg', 'cg', 'gc', 'ee', 'dg', 'fd', 'ec']) g = play(g, m, 0);
  return position(g);
}

/**
 * True when two evaluations agree within float noise: win rate within 2 points, score lead within
 * half a point, every policy entry within 0.02 and every ownership value within 0.05. Far above the
 * float32 differences between backends, far below a broken kernel.
 */
export function sameEvaluation(a: EngineEvaluation, b: EngineEvaluation): boolean {
  if (!(Math.abs(a.winrate - b.winrate) <= 0.02) || !(Math.abs(a.scoreLead - b.scoreLead) <= 0.5)) return false;
  if (a.policy.length !== b.policy.length || a.ownership.length !== b.ownership.length) return false;
  for (let i = 0; i < a.policy.length; i++) if (!(Math.abs(a.policy[i] - b.policy[i]) <= 0.02)) return false;
  for (let i = 0; i < a.ownership.length; i++) if (!(Math.abs(a.ownership[i] - b.ownership[i]) <= 0.05)) return false;
  return true;
}
