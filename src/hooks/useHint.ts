/**
 * Hint bulb (DESIGN 7.3): available against the computer (on the player's turn) and in
 * pass-and-play (for the side to move); hidden in rooms.
 *
 * - Tap 1: the engine's best point for the side to move pulses green (`hint = { best }`). The game
 *   is marked assisted (`onAssisted`). When the best move is a pass, `passBest` is true and nothing
 *   pulses (the page says so with `assist.hintPass`).
 * - Tap 2 and later: the top three points with numbers 1–3 (`hint = { top }`), a new object on every
 *   tap so the board replays it, until the next move.
 * - Hold 1 s (`previewStart` … `previewEnd`, the page's long press): the territory preview, the
 *   engine's ownership map (`preview.ownership`) and the score lead as `B+3.5` (`preview.note`, for
 *   the info pill's note). Marks the game assisted. Without the engine (`available` false, or the
 *   evaluation fails) it shows nothing and calls `onUnavailable` (toast `assist.previewNeedsEngine`).
 * - Precomputed: while the player thinks (`enabled`, engine ready), the hook asks for the top moves
 *   (`analyze`) and the ownership (`evaluate`) of the position after `precomputeDelayMs`, so that both
 *   appear at once in most cases. The delay lets the blunder guard's "before" evaluation go first.
 *   A precomputation cancelled by the guard's `stop()` is started again while the position stays.
 * - Any change of position (a move, undo, redo) or of the session forgets the hint and the preview;
 *   answers for an old position are ignored. The hint never plays the move.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { isEngineAbort } from '@/lib/engine/handle';
import type { EngineApi, Game, Point } from '@/lib/types';
import zigo, { isPass } from '@/lib/zigo';

/** Visits of the hint search (`analyze`, small net); it also stops after `HINT_TIME_MS`. */
export const HINT_VISITS = 32;
export const HINT_TIME_MS = 1500;
/** Visits of the territory preview's search (`evaluate`, small net), for an ownership map steadier than one evaluation. */
export const PREVIEW_VISITS = 16;
export const PREVIEW_TIME_MS = 1000;
/** Precomputation waits this long after the position settles. */
export const PRECOMPUTE_DELAY_MS = 300;
/** A cancelled precomputation is started again at most this often per position. */
const PRECOMPUTE_RETRIES = 2;

/** What the board shows for the hint (the board's `BoardHint`). */
export type HintMarks = { readonly best: Point } | { readonly top: readonly Point[] } | null;

export interface TerritoryPreviewState {
  /** size², row-major from the top, −1..1, +1 = Black (the board's `territoryPreview.ownership`). */
  readonly ownership: Float32Array;
  /** The score lead from Black's view in points (negative: White leads). */
  readonly blackLead: number;
  /** `B+3.5` / `W+0.5`: the info pill's faint note. */
  readonly note: string;
}

export interface UseHintOptions {
  /** The shared engine (`useZigoEngine()`). */
  engine: EngineApi;
  /** The live game (`session.game`), or null. */
  game: Game | null;
  /**
   * Hint allowed now: `flags.hint`, computer or pass-and-play, phase `playing` (not scoring, not
   * over), and against the computer only on the player's turn.
   */
  enabled: boolean;
  /**
   * The engine can answer (stage 1 is on the device). Default: the engine is ready. While false the
   * hook precomputes nothing and the preview calls `onUnavailable`; a tap still asks the engine
   * (which loads lazily) and shows `pending`.
   */
  available?: boolean;
  /** A hint or the preview was shown: mark the game assisted (`useGameState.markAssisted`). */
  onAssisted?: () => void;
  /** The engine is unavailable for a tap (not called for a cancelled search). */
  onFail?: (error: unknown) => void;
  /** The preview has no engine: show `assist.previewNeedsEngine`. */
  onUnavailable?: () => void;
  /** Session identity (`session.id`); a change forgets the hint. */
  sessionKey?: string | null;
  /** Default `PRECOMPUTE_DELAY_MS`; negative turns the precomputation off. */
  precomputeDelayMs?: number;
}

export interface HintState {
  /** The bulb's tap. */
  tap(): void;
  /** What the board shows (`GoBoard hint`), or null. A new object on every tap. */
  readonly hint: HintMarks;
  /** 0 = nothing shown, 1 = best point, 2 = top three. */
  readonly step: 0 | 1 | 2;
  /** The best move is a pass (nothing to pulse). */
  readonly passBest: boolean;
  /** Waiting for the engine after a tap (show the bulb busy, `assist.hintBusy`). */
  readonly pending: boolean;
  /** Start the territory preview (the 1-second hold reached). */
  previewStart(): void;
  /** End the territory preview (released). */
  previewEnd(): void;
  /** The preview while held, else null. */
  readonly preview: TerritoryPreviewState | null;
  /** Held, waiting for the ownership map. */
  readonly previewPending: boolean;
  /** Forget the hint and the preview. */
  reset(): void;
}

/** `B+3.5` / `W+12`: a score lead from Black's view, rounded to half points (at least 0.5). */
export function formatLead(blackLead: number): string {
  const half = Math.max(1, Math.round(Math.abs(blackLead) * 2));
  return `${blackLead >= 0 ? 'B' : 'W'}+${half / 2}`;
}

interface Analysis {
  readonly moves: readonly Point[];
}

interface Ownership {
  readonly ownership: Float32Array;
  readonly blackLead: number;
}

/** Per-position cache: settled values and requests in flight. */
interface Entry {
  key: string;
  analysis?: Analysis;
  ownership?: Ownership;
  analysisP?: Promise<Analysis | null>;
  ownershipP?: Promise<Ownership | null>;
  retries: number;
}

interface Shown {
  key: string;
  step: 1 | 2;
  hint: HintMarks;
  passBest: boolean;
}

function positionKey(g: Game, sessionKey: string | null): string {
  let s = `${sessionKey ?? ''}|${g.cursor}:`;
  for (let i = 0; i < g.cursor; i++) s += g.plies[i].m;
  return s;
}

export function useHint(opts: UseHintOptions): HintState {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const { game, enabled, sessionKey = null } = opts;
  const live = !!game && !game.end && !game.scoring;
  const key = game && live ? positionKey(game, sessionKey) : null;
  const keyRef = useRef(key);
  keyRef.current = key;
  const ready = opts.engine.state === 'ready';
  const available = opts.available ?? ready;

  const entry = useRef<Entry | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ key: string; value: Ownership | null } | null>(null);
  const holding = useRef<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  /** A precomputation was cancelled (the guard's `stop()`): start it again while the position stays. */
  const retryLater = useCallback((e: Entry, k: string) => {
    if (entry.current !== e || keyRef.current !== k || e.retries >= PRECOMPUTE_RETRIES) return;
    e.retries++;
    setRetryTick((n) => n + 1);
  }, []);

  const entryFor = useCallback((k: string): Entry => {
    if (!entry.current || entry.current.key !== k) entry.current = { key: k, retries: 0 };
    return entry.current;
  }, []);

  /** The top moves of position `k` (shared by the precomputation and a tap). Resolves null when cancelled or failed. */
  const requestAnalysis = useCallback(
    (k: string, g: Game, report: boolean): Promise<Analysis | null> => {
      const e = entryFor(k);
      if (e.analysis) return Promise.resolve(e.analysis);
      if (e.analysisP) return e.analysisP;
      let p: Promise<{ move: Point }[]>;
      try {
        p = optsRef.current.engine.analyze(zigo.position(g), 4, { visits: HINT_VISITS, timeMs: HINT_TIME_MS, net: 'small' });
      } catch (err) {
        p = Promise.reject(err);
      }
      const out = p.then(
        (list) => {
          const a: Analysis = { moves: list.map((c) => c.move).filter((m) => isPass(m) || zigo.isLegal(g, m)) };
          if (entry.current === e) {
            e.analysis = a;
            e.analysisP = undefined;
          }
          return a;
        },
        (err: unknown) => {
          if (entry.current === e) e.analysisP = undefined;
          if (report && !isEngineAbort(err)) optsRef.current.onFail?.(err);
          if (isEngineAbort(err)) retryLater(e, k);
          return null;
        },
      );
      e.analysisP = out;
      return out;
    },
    [entryFor, retryLater],
  );

  /** The ownership map and score lead of position `k`. Resolves null without an answer. */
  const requestOwnership = useCallback(
    (k: string, g: Game): Promise<Ownership | null> => {
      const e = entryFor(k);
      if (e.ownership) return Promise.resolve(e.ownership);
      if (e.ownershipP) return e.ownershipP;
      let p: Promise<{ scoreLead: number; ownership: Float32Array } | null>;
      try {
        p = optsRef.current.engine.evaluate(zigo.position(g), { visits: PREVIEW_VISITS, timeMs: PREVIEW_TIME_MS, net: 'small' });
      } catch {
        p = Promise.resolve(null);
      }
      const out = p
        .catch(() => null)
        .then((ev) => {
          if (entry.current === e) e.ownershipP = undefined;
          if (!ev) {
            retryLater(e, k);
            return null;
          }
          const o: Ownership = { ownership: ev.ownership, blackLead: g.turn === 'B' ? ev.scoreLead : -ev.scoreLead };
          if (entry.current === e) e.ownership = o;
          return o;
        });
      e.ownershipP = out;
      return out;
    },
    [entryFor, retryLater],
  );

  // A new position forgets the hint and the preview.
  useEffect(() => {
    setShown(null);
    setPendingKey(null);
    setPreview(null);
    holding.current = null;
  }, [key]);

  /* ---- precomputation while the player thinks ---- */
  useEffect(() => {
    const delay = optsRef.current.precomputeDelayMs ?? PRECOMPUTE_DELAY_MS;
    if (!key || !enabled || !ready || !available || delay < 0) return;
    const g = optsRef.current.game as Game;
    const e = entryFor(key);
    if (e.analysis && e.ownership) return;
    const timer = setTimeout(() => {
      if (keyRef.current !== key) return;
      void requestAnalysis(key, g, false).then(() => {
        if (keyRef.current === key) void requestOwnership(key, g);
      });
    }, delay);
    return () => clearTimeout(timer);
    // `game` is read through `key` (optsRef).
  }, [key, enabled, ready, available, retryTick, entryFor, requestAnalysis, requestOwnership]);

  const showStep1 = useCallback((k: string, a: Analysis) => {
    const best = a.moves[0] ?? null;
    const passBest = !!best && isPass(best);
    setShown({ key: k, step: 1, hint: best && !passBest ? { best } : null, passBest });
    optsRef.current.onAssisted?.();
  }, []);

  const tap = useCallback(() => {
    const o = optsRef.current;
    const g = o.game;
    const k = keyRef.current;
    if (!o.enabled || !g || !k) return;
    if (shown && shown.key === k) {
      const e = entryFor(k);
      const top = (e.analysis?.moves ?? []).filter((m) => !isPass(m)).slice(0, 3);
      setShown({ key: k, step: 2, hint: top.length > 0 ? { top } : null, passBest: shown.passBest });
      return;
    }
    const e = entryFor(k);
    if (e.analysis) {
      showStep1(k, e.analysis);
      return;
    }
    if (pendingKey === k) return;
    setPendingKey(k);
    void requestAnalysis(k, g, true).then((a) => {
      if (keyRef.current !== k) return;
      setPendingKey((p) => (p === k ? null : p));
      if (a) showStep1(k, a);
    });
  }, [shown, pendingKey, entryFor, requestAnalysis, showStep1]);

  const previewStart = useCallback(() => {
    const o = optsRef.current;
    const g = o.game;
    const k = keyRef.current;
    if (!o.enabled || !g || !k) return;
    holding.current = k;
    const e = entryFor(k);
    if (e.ownership) {
      setPreview({ key: k, value: e.ownership });
      o.onAssisted?.();
      return;
    }
    const canAsk = o.available ?? o.engine.state === 'ready';
    if (!canAsk || o.engine.state === 'failed') {
      o.onUnavailable?.();
      return;
    }
    setPreview({ key: k, value: null });
    void requestOwnership(k, g).then((own) => {
      if (holding.current !== k || keyRef.current !== k) return;
      if (!own) {
        setPreview(null);
        optsRef.current.onUnavailable?.();
        return;
      }
      setPreview({ key: k, value: own });
      optsRef.current.onAssisted?.();
    });
  }, [entryFor, requestOwnership]);

  const previewEnd = useCallback(() => {
    holding.current = null;
    setPreview(null);
  }, []);

  const reset = useCallback(() => {
    setShown(null);
    setPendingKey(null);
    setPreview(null);
    holding.current = null;
  }, []);

  const current = shown && shown.key === key ? shown : null;
  const pv = preview && preview.key === key ? preview : null;
  return {
    tap,
    hint: current?.hint ?? null,
    step: current?.step ?? 0,
    passBest: current?.passBest ?? false,
    pending: pendingKey !== null && pendingKey === key,
    previewStart,
    previewEnd,
    preview: pv && pv.value ? { ownership: pv.value.ownership, blackLead: pv.value.blackLead, note: formatLead(pv.value.blackLead) } : null,
    previewPending: !!pv && !pv.value,
    reset,
  };
}

export default useHint;
