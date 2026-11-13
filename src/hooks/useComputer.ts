/**
 * The computer opponent's turn loop (DESIGN 10) and the engine preparation behind the Start pill
 * (DESIGN 10.1, 14).
 *
 * `useComputer`: whenever the live computer game has the computer to move, ask the engine for a
 * move at the game's level, apply the level rules of `lib/levels.ts` (`avoidFor`, `pickMove`, open
 * dame before a pass), wait until at least `MIN_REPLY_MS` have passed since the turn began (so
 * stones never teleport), and hand the move to `onMove` (`tt` = pass). This covers:
 * - the computer's first move when it plays Black in an even game, or White in a handicap game
 *   (White moves first there);
 * - a resumed game where the computer is to move;
 * - undoing the very first turn (DESIGN 10.3): the computer is to move again and moves again;
 * - passing: the engine passes when pass is its best move; under area rules it first fills an open
 *   dame (`openDame`, one extra evaluation, only when it wants to pass). After the player's pass,
 *   the computer's pass is the second pass and the game goes to scoring (`useGameState`);
 * - resigning (DESIGN 10.4): levels 5–12, `resignDecision` over its own recent turns; `onResign`
 *   ends the game (`useGameState.finish({ winner: player, by: 'resign' })`, overlay title
 *   `Level 8 resigned. You won!`).
 *
 * Every turn has a generation number. Any change of position (move, undo, redo), session, level,
 * or leaving the game (enabled → false) starts a new generation: a result of an older one is
 * ignored, and its still-running search is stopped. In timed games the engine is told its own
 * clock (`engineClock`) and keeps to it.
 *
 * `useEngineStart`: the Start pill's spinner with progress while the engine loads for a new
 * computer game (stage 2 for levels 8–12), then go (or a calm failure).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { EngineUnavailableError, isEngineAbort } from '@/lib/engine/handle';
import { runningDownload, subscribeRunningDownloads, type EngineStage } from '@/lib/engine/offline';
import {
  MIN_REPLY_MS,
  avoidFor,
  engineClock,
  needsLargeNet,
  nextSeed,
  openDame,
  pickMove,
  resignDecision,
  seededRng,
  type TurnView,
} from '@/lib/levels';
import type { Color, EngineApi, EngineMove, Game, Now, Point, Result, Size, TcString, TimeControl } from '@/lib/types';
import zigo, { PASS, isPass, pointToIndex, toTc } from '@/lib/zigo';

/* ---------------------------------------------------------------------------------------------- */
/* Pure helpers                                                                                     */
/* ---------------------------------------------------------------------------------------------- */

/** The plies up to the cursor as one string: the identity of a position within a session. */
export function lineKey(g: Game): string {
  let s = '';
  for (let i = 0; i < g.cursor; i++) s += g.plies[i].m;
  return s;
}

/** The result when the computer playing `computerColor` resigns. */
export function computerResignation(computerColor: Color): Result {
  return { winner: computerColor === 'B' ? 'W' : 'B', by: 'resign' };
}

function isUnavailable(e: unknown): boolean {
  return e instanceof EngineUnavailableError || (e instanceof Error && e.name === 'EngineUnavailableError');
}

/**
 * The computer's recorded views of its own consecutive turns ending at this position: the entries
 * stored for the positions 2, 4, … plies earlier on the same line, oldest first.
 */
function recentTurns(memo: ReadonlyMap<string, TurnView>, line: string, current: TurnView, max: number): TurnView[] {
  const out: TurnView[] = [current];
  // Each ply is two characters; the computer's previous turn was two plies (four characters) earlier.
  for (let cut = line.length - 4; cut >= 0 && out.length < max; cut -= 4) {
    const v = memo.get(line.slice(0, cut));
    if (!v) break;
    out.unshift(v);
  }
  return out;
}

/* ---------------------------------------------------------------------------------------------- */
/* useComputer                                                                                      */
/* ---------------------------------------------------------------------------------------------- */

/** Searches cancelled by somebody else's `stop()` are retried this often per turn. */
const ABORT_RETRIES = 2;
/** Timeout of the evaluation that looks for open dame before a pass. */
const DAME_CHECK_TIMEOUT_MS = 5000;

export interface UseComputerOptions {
  /** The shared engine (`useZigoEngine()`). */
  engine: EngineApi;
  /** The live game (`session.game`), or null. */
  game: Game | null;
  /**
   * Computer mode, phase `playing` (not review, not the start screen), `flags.computer`. The hook
   * itself waits for the computer's turn and stops when the game is over or in scoring.
   */
  enabled: boolean;
  /** The computer's color: the opposite of `session.color`. */
  computerColor: Color | null;
  /** Level 1–12 (`session.level`). */
  level: number;
  /** Time control of the game (`session.tc`), or null. */
  tc?: TimeControl | TcString | null;
  /** Plays the computer's move: `useGameState.play(point, ms)` (`tt` = pass). Called at most once per turn. */
  onMove: (point: Point, ms: number) => void;
  /** The computer resigns (levels 5–12): `useGameState.finish(computerResignation(computerColor))`. */
  onResign?: (result: Result) => void;
  /** The engine failed to load or crashed: show the calm toast (`engine.failed` / `engine.failedOffline` + `engine.retry`). */
  onFail?: (error: unknown) => void;
  /** Time the computer used on this turn, read when it moves (`useClock().elapsed`). Default: wall time since the turn began. */
  elapsed?: () => number;
  /** Session identity (`session.id`); a change starts a new turn. */
  sessionKey?: string | null;
  /** Default `Date.now`. */
  now?: Now;
  /** Default `MIN_REPLY_MS` (400). */
  minReplyMs?: number;
  /** Randomness of the level rules (level 1's humanizing, the engine's seeds). Default `Math.random`. */
  rng?: () => number;
}

export interface ComputerState {
  /** The computer is searching or waiting out the minimum reply time. */
  readonly thinking: boolean;
  /** The last search failed because the engine is unavailable. */
  readonly failed: boolean;
  /** Try the turn again (the engine retries loading). The toast's `engine.retry` action. */
  retry(): void;
}

export function useComputer(opts: UseComputerOptions): ComputerState {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const { game, enabled, computerColor, level, sessionKey = null } = opts;
  const due = enabled && !!game && !game.end && !game.scoring && game.turn === computerColor;
  const turnKey = due && game ? `${sessionKey ?? ''}|${level}|${game.cursor}|${lineKey(game)}` : null;

  const gen = useRef(0);
  const [thinking, setThinking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  /** The computer's views of its own turns, by line, for the resign rule; per session and level. */
  const views = useRef<{ owner: string; map: Map<string, TurnView> }>({ owner: '', map: new Map() });

  useEffect(() => {
    if (!turnKey) {
      setThinking(false);
      return;
    }
    const counter = gen;
    const my = ++counter.current;
    const o = optsRef.current;
    const g = o.game as Game;
    const color = o.computerColor as Color;
    const lvl = o.level;
    const rng = o.rng ?? Math.random;
    const now = o.now ?? Date.now;
    const start = now();
    const minReply = Math.max(0, o.minReplyMs ?? MIN_REPLY_MS);
    const tc = toTc(o.tc ?? null);
    const clock = engineClock(g, tc, color);
    const pos = zigo.position(g);
    const line = lineKey(g);
    const owner = `${o.sessionKey ?? ''}|${lvl}`;
    if (views.current.owner !== owner) views.current = { owner, map: new Map() };
    let searching = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setThinking(true);
    setFailed(false);

    const deliver = (point: Point) => {
      if (my !== gen.current) return;
      setThinking(false);
      const cur = optsRef.current;
      const ms = cur.elapsed ? cur.elapsed() : now() - start;
      cur.onMove(point, Math.max(0, ms));
    };

    const resign = () => {
      if (my !== gen.current) return;
      setThinking(false);
      optsRef.current.onResign?.(computerResignation(color));
    };

    const after = (fn: () => void) => {
      const wait = Math.max(0, start + minReply - now());
      if (wait === 0) fn();
      else timer = setTimeout(fn, wait);
    };

    /** Before passing under area rules: fill an open dame (DESIGN 10.4: never pass while a point is contested). */
    const dameOrPass = async (res: EngineMove): Promise<Point> => {
      if (g.settings.rules !== 'area') return PASS;
      let ownership: Float32Array | null = null;
      let policy: Float32Array | null = null;
      try {
        const e = await o.engine.evaluate(pos, { net: 'small' }, DAME_CHECK_TIMEOUT_MS);
        ownership = e?.ownership ?? null;
        policy = e?.policy ?? null;
      } catch {
        ownership = null;
      }
      const dame = openDame(g, ownership);
      if (dame.length === 0) return PASS;
      const prior = (p: Point) => {
        const fromCands = res.candidates?.find((c) => c.move === p)?.prior;
        if (fromCands !== undefined) return fromCands;
        return policy ? (policy[pointToIndex(p, g.settings.size)] ?? 0) : 0;
      };
      return [...dame].sort((a, b) => prior(b) - prior(a) || (a < b ? -1 : 1))[0];
    };

    const search = (retries: number) => {
      searching = true;
      let p: Promise<EngineMove>;
      try {
        p = o.engine.genmove(pos, lvl, clock, { avoid: avoidFor(g, lvl), seed: nextSeed(rng) });
      } catch (e) {
        p = Promise.reject(e);
      }
      p.then(
        async (res) => {
          if (my !== gen.current) return;
          const view: TurnView = { winrate: res.winrate, scoreLead: res.scoreLead };
          views.current.map.set(line, view);
          const turns = recentTurns(views.current.map, line, view, 3);
          if (res.move === 'resign' || resignDecision(lvl, g.settings.size as Size, g.cursor, turns)) {
            searching = false;
            after(resign);
            return;
          }
          let move = pickMove(g, lvl, res, rng).move;
          if (isPass(move)) move = await dameOrPass(res);
          if (my !== gen.current) return;
          searching = false;
          after(() => deliver(move));
        },
        (err: unknown) => {
          if (my !== gen.current) return;
          searching = false;
          if (isEngineAbort(err) && retries > 0) {
            search(retries - 1);
            return;
          }
          setThinking(false);
          if (isUnavailable(err) || optsRef.current.engine.state === 'failed') {
            setFailed(true);
            optsRef.current.onFail?.(err);
          }
        },
      );
    };
    search(ABORT_RETRIES);

    return () => {
      counter.current++;
      clearTimeout(timer);
      // Free the engine for whatever comes next (undo, leave). Only our own search is running
      // during the computer's turn, so this does not cancel anyone else's.
      if (searching) o.engine.stop();
    };
  }, [turnKey, attempt]);

  const retry = useCallback(() => {
    setFailed(false);
    setAttempt((n) => n + 1);
  }, []);

  return { thinking, failed, retry };
}

/** A seeded `rng` for `useComputer` (tests, reproducible games). */
export { seededRng };

/* ---------------------------------------------------------------------------------------------- */
/* useEngineStart: the Start pill while the engine loads                                            */
/* ---------------------------------------------------------------------------------------------- */

export interface EngineStart {
  /** Show the Start pill's spinner (`StartPill loading`). */
  readonly loading: boolean;
  /** 0..1 for the Start pill's `progress`. */
  readonly progress: number;
  /**
   * Load the engine before a computer game at `level` starts: stage 1, or stage 2 for levels 8–12.
   * Resolves true when it is ready (at once when it already is), false when it failed (`onFail` was
   * called) or another `prepare` superseded it. Call `cancel()` when the user leaves the start
   * screen meanwhile.
   */
  prepare(level: number): Promise<boolean>;
  /** Forget a running `prepare` (it resolves false); the download itself goes on in the background. */
  cancel(): void;
}

export interface UseEngineStartOptions {
  /** Called with the load error; show `engine.failed` (online) or `engine.failedOffline` (offline). */
  onFail?: (error: unknown) => void;
}

/**
 * DESIGN 10.1 / 14: the engine is loaded on the first computer game; meanwhile the Start pill shows
 * the spinner with progress. Usage on the Start tap for a computer game:
 * `if (await engineStart.prepare(level)) gs.start();`
 *
 * When the page is downloading a stage the level needs (`runningDownload` of lib/engine/offline.ts:
 * stage 1, and for levels 8–12 stage 2), `prepare` first waits for that download, with its percent
 * on the pill (the status line's figure), and only then loads the engine, which reads the files from
 * `engine-cache` instead of fetching them a second time. When that download fails, the engine loads
 * (and fetches) as before.
 */
export function useEngineStart(engine: EngineApi, opts: UseEngineStartOptions = {}): EngineStart {
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const onFailRef = useRef(opts.onFail);
  onFailRef.current = opts.onFail;
  const gen = useRef(0);
  const [waiting, setWaiting] = useState(false);
  /** The pill's figure while the page's download of a stage runs (0–1), then the floor it reached. */
  const [download, setDownload] = useState<{ readonly running: boolean; readonly progress: number } | null>(null);

  // Unmount: a `prepare` still waiting resolves false.
  useEffect(() => {
    const counter = gen;
    return () => {
      counter.current++;
    };
  }, []);

  const prepare = useCallback(async (level: number): Promise<boolean> => {
    const e = engineRef.current;
    const large = needsLargeNet(level);
    if (e.state === 'ready' && e.nets.small && (!large || e.nets.large)) return true;
    const my = ++gen.current;
    setWaiting(true);
    setDownload(null);
    try {
      // Stage 2 starts the moment stage 1's download ends (useEngineOffline), so it is seen here.
      for (const stage of (large ? [1, 2] : [1]) as EngineStage[]) {
        if (engineRef.current.nets[stage === 1 ? 'small' : 'large']) continue;
        const ok = await waitForDownload(stage, (percent) => {
          if (my === gen.current) setDownload({ running: true, progress: percent / 100 });
        });
        if (my !== gen.current) return false;
        // Downloaded: the engine now only reads and builds, so keep the pill near the end. Failed: the
        // engine fetches the files itself, with its own progress.
        if (ok !== null) setDownload(ok ? { running: false, progress: 0.99 } : null);
      }
      await e.load(large ? 2 : 1);
      if (my !== gen.current) return false;
      setWaiting(false);
      setDownload(null);
      return true;
    } catch (err) {
      if (my !== gen.current) return false;
      setWaiting(false);
      setDownload(null);
      onFailRef.current?.(err);
      return false;
    }
  }, []);

  const cancel = useCallback(() => {
    gen.current++;
    setWaiting(false);
    setDownload(null);
  }, []);

  const loading = waiting;
  const progress = !loading ? 0 : !download ? engine.progress : download.running ? download.progress : Math.max(download.progress, engine.progress);
  return { loading, progress, prepare, cancel };
}

/**
 * Waits for the page's running download of `stage`, reporting its percent. Resolves null at once when
 * none runs, else true when it cached the stage, false when it failed or was aborted.
 */
async function waitForDownload(stage: EngineStage, onPercent: (percent: number) => void): Promise<boolean | null> {
  const running = runningDownload(stage);
  if (!running) return null;
  onPercent(running.percent);
  const unsubscribe = subscribeRunningDownloads(() => {
    const now = runningDownload(stage);
    if (now === running) onPercent(now.percent);
  });
  try {
    return await running.done;
  } finally {
    unsubscribe();
  }
}

export default useComputer;
