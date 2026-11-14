/**
 * Blunder guard (DESIGN 7.2): against the computer, with helpers on.
 *
 * - When the player's turn begins, the engine evaluates the position with the small net (the
 *   "before" evaluation, one network evaluation) and the hook keeps it, so that at commit time only
 *   the "after" evaluation has to run.
 * - `check(point)` is called with the committed stone BEFORE it is played. It answers within about
 *   `GUARD_BUDGET_MS`:
 *   - `commit`: play it (not a blunder, engine late or not ready, guard off, a pass, or the
 *     confirmation of a stone refused less than 5 s ago);
 *   - `refuse`: do not play it; it pulses red once at its point (`blunder` / `blunderKey` feed the
 *     board) and the game is marked assisted (`onAssisted`);
 *   - `stale`: the position changed or a newer check started meanwhile; do nothing.
 * - The rules-only self-atari check (3+ stones) needs no engine and answers at once.
 * - The engine check runs only when the engine is ready. To meet the budget it first calls
 *   `engine.stop()`, which cancels the hint's precomputation queued for this turn (the hint starts it
 *   again if the stone is refused). Nothing else searches on the player's turn against the computer.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BEFORE_TIMEOUT_MS,
  CONFIRM_WINDOW_MS,
  GUARD_BUDGET_MS,
  guardKey,
  isConfirmation,
  judgeEvals,
  selfAtariVerdict,
  type BlunderReason,
  type GuardEval,
  type Refusal,
  type Verdict,
} from '@/lib/blunder';
import type { Color, EngineApi, Game, Now, Point } from '@/lib/types';
import zengo, { isPass } from '@/lib/zengo';

export interface UseBlunderGuardOptions {
  /** The shared engine (`useZengoEngine()`). */
  engine: EngineApi;
  /** The live game (`session.game`), or null. */
  game: Game | null;
  /**
   * Guard on: computer mode, helpers on, `flags.blunderGuard`, live (not review, not scoring, not
   * over). While false, `check` commits at once and no evaluation is started.
   */
  enabled: boolean;
  /** The player's color (`session.color`). The guard only runs on the player's turn. */
  playerColor: Color | null;
  /** A stone was bounced: mark the game assisted (`useGameState.markAssisted`). */
  onAssisted?: () => void;
  /** Session identity (`session.id`); part of the position key. */
  sessionKey?: string | null;
  /** Clock for the 5-second window. Default `Date.now`. */
  now?: Now;
  /** Default `GUARD_BUDGET_MS`. */
  budgetMs?: number;
  /** Default `CONFIRM_WINDOW_MS`. */
  confirmMs?: number;
}

export type BlunderCheck =
  | { readonly action: 'commit' }
  | { readonly action: 'refuse'; readonly point: Point; readonly reason: BlunderReason }
  | { readonly action: 'stale' };

export interface BlunderGuard {
  /** True when the player's stones go through `check` now (enabled, live, player's turn). */
  readonly active: boolean;
  /** Decide on a committed stone; see the file comment. Never rejects. */
  check(point: Point): Promise<BlunderCheck>;
  /** The point being checked, for an optimistic board while the check runs; else null. */
  readonly checking: Point | null;
  /** Point of the last refused stone (pulses red), until the position changes. */
  readonly blunder: Point | null;
  /** Increases with every refusal, so the same point pulses again. */
  readonly blunderKey: number;
  /** Forget the refusal and the pulse. */
  clear(): void;
}

const COMMIT: BlunderCheck = Object.freeze({ action: 'commit' });
const STALE: BlunderCheck = Object.freeze({ action: 'stale' });

interface BeforeEntry {
  key: string;
  promise: Promise<GuardEval | null>;
  /** undefined while pending. */
  value?: GuardEval | null;
}

/** Resolves with `p`'s value, or null when `ms` pass first. */
function withDeadline<T>(p: Promise<T | null>, ms: number): Promise<T | null> {
  if (ms <= 0) return Promise.race([p, Promise.resolve(null)]);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/** One small-net evaluation; never rejects. */
function safeEvaluate(engine: EngineApi, g: Game, timeoutMs: number): Promise<GuardEval | null> {
  try {
    return engine
      .evaluate(zengo.position(g), { net: 'small' }, timeoutMs)
      .then((e) => (e ? { winrate: e.winrate, scoreLead: e.scoreLead } : null))
      .catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

export function useBlunderGuard(opts: UseBlunderGuardOptions): BlunderGuard {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const now = useCallback(() => (optsRef.current.now ? optsRef.current.now() : Date.now()), []);

  const { game, enabled, playerColor, sessionKey = null } = opts;
  const live = !!game && !game.end && !game.scoring;
  const key = game ? `${sessionKey ?? ''}|${guardKey(game)}` : null;
  const active = enabled && live && game!.turn === playerColor;
  const ready = opts.engine.state === 'ready';

  const before = useRef<BeforeEntry | null>(null);
  const refusal = useRef<Refusal | null>(null);
  const checkGen = useRef(0);
  const [checking, setChecking] = useState<Point | null>(null);
  const [pulse, setPulse] = useState<{ point: Point | null; key: number }>({ point: null, key: 0 });

  /* ---- "before" evaluation as soon as the player's turn begins (and the engine can answer) ---- */
  useEffect(() => {
    if (!active || !ready || !key || !game) return;
    if (before.current?.key === key && before.current.value !== null) return;
    const entry: BeforeEntry = { key, promise: safeEvaluate(optsRef.current.engine, game, BEFORE_TIMEOUT_MS) };
    entry.promise.then((v) => {
      entry.value = v;
    });
    before.current = entry;
    // `game` is read through `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ready, key]);

  /* ---- a new position: the pulse and the check belong to the old one ---- */
  useEffect(() => {
    setPulse((p) => (p.point ? { point: null, key: p.key } : p));
    setChecking(null);
    checkGen.current++;
  }, [key]);

  const check = useCallback(
    async (point: Point): Promise<BlunderCheck> => {
      const o = optsRef.current;
      const g = o.game;
      if (!o.enabled || !g || g.end || g.scoring || g.turn !== o.playerColor) return COMMIT;
      if (isPass(point) || !zengo.isLegal(g, point)) return COMMIT; // a pass, or illegal: not the guard's business
      const k = `${o.sessionKey ?? ''}|${guardKey(g)}`;
      const t0 = now();
      if (isConfirmation(refusal.current, k, point, t0, o.confirmMs ?? CONFIRM_WINDOW_MS)) {
        refusal.current = null;
        return COMMIT;
      }

      const id = ++checkGen.current;
      let verdict: Verdict = selfAtariVerdict(g, point);
      if (!verdict.flag && o.engine.state === 'ready') {
        setChecking(point);
        const budget = Math.max(0, o.budgetMs ?? GUARD_BUDGET_MS);
        try {
          const cached = before.current && before.current.key === k ? before.current : null;
          const pending = !!cached && cached.value === undefined;
          // Free the queue for the "after" evaluation, unless the turn's "before" is still running.
          if (!pending) o.engine.stop();
          // Reuse the turn's evaluation; without one (or an empty one) ask again within the budget.
          const beforeP = cached && cached.value !== null ? cached.promise : safeEvaluate(o.engine, g, budget);
          const after = zengo.play(g, point, 0);
          const afterP = safeEvaluate(o.engine, after, budget);
          const [b, a] = await Promise.all([withDeadline(beforeP, budget), withDeadline(afterP, budget)]);
          verdict = judgeEvals(g.settings.size, b, a);
        } catch {
          verdict = { flag: false };
        }
        const cur = optsRef.current.game;
        if (id !== checkGen.current || !cur || `${optsRef.current.sessionKey ?? ''}|${guardKey(cur)}` !== k) return STALE;
        setChecking(null);
      }

      if (!verdict.flag) return COMMIT;
      refusal.current = { key: k, point, at: now() };
      setPulse((p) => ({ point, key: p.key + 1 }));
      optsRef.current.onAssisted?.();
      return { action: 'refuse', point, reason: verdict.reason ?? 'drop' };
    },
    [now],
  );

  const clear = useCallback(() => {
    refusal.current = null;
    setPulse((p) => (p.point ? { point: null, key: p.key } : p));
  }, []);

  return { active, check, checking, blunder: pulse.point, blunderKey: pulse.key, clear };
}

export default useBlunderGuard;
