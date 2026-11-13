/**
 * Keeps the offline copy of the engine assets and reports it for the start screen (DESIGN 14).
 *
 * - Stage 1 (TF.js backends + small net): on launch, checks `engine-cache`; if missing and online,
 *   downloads after a short delay (so it does not compete with the first paint). Offline, it waits
 *   for the `online` event. With Save-Data on, it waits for a tap (`download(1)`). A failed download
 *   also waits for a tap.
 * - Stage 2 (large net): checked on launch too; downloaded once stage 1 is ready and it is wanted:
 *   a level 8–12 is selected (`large`) or the app runs installed (`display-mode: standalone`). When
 *   stage 1's download ends, stage 2 starts in the same step, before anyone waiting on stage 1's
 *   `runningDownload(1).done` resumes; so the Start pill, which waits for a running stage 1 and then
 *   for a running stage 2, never has the engine fetch the large net beside this download.
 * - After a successful download the page asks for persistent storage (`navigator.storage.persist()`).
 *
 * Nothing runs while `enabled` is false (default `COMPUTER_ENABLED` from `lib/flags.ts`): both stages
 * read `unsupported` and nothing is fetched. Milestone 1 ships with it off.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { COMPUTER_ENABLED } from '@/lib/flags';
import {
  downloadStage,
  isStageCached,
  requestPersistence,
  statusLine,
  type EngineOfflineDeps,
  type EngineOfflineStatus,
  type EngineStage,
  type EngineStatusLine,
} from '@/lib/engine/offline';

export const ENGINE_DOWNLOAD_DELAY_MS = 1000;

export interface UseEngineOfflineOptions extends EngineOfflineDeps {
  /** The computer exists in this build. Default `COMPUTER_ENABLED`. */
  enabled?: boolean;
  /** A level 8–12 is selected: stage 2 is wanted (and the status line reports it). */
  large?: boolean;
  /** Base URL the engine files resolve against; `document.baseURI` by default. */
  base?: string;
  /** Delay before the automatic stage 1 download. */
  delayMs?: number;
  /** Overrides for tests. */
  online?: () => boolean;
  saveData?: () => boolean;
  supported?: boolean;
  /** The app runs installed: stage 2 is wanted too. Default: `display-mode: standalone`. */
  standalone?: () => boolean;
  /** Asks for persistent storage. Default `navigator.storage.persist()`. */
  persist?: () => Promise<boolean>;
}

export interface EngineOfflineState {
  readonly stage1: EngineOfflineStatus;
  readonly stage2: EngineOfflineStatus;
  /** What the status line shows for the selected level (`statusLine`). */
  readonly line: EngineStatusLine;
  /** Starts (or retries) a stage's download; stage 2 waits for stage 1. Default stage 1. */
  download(stage?: EngineStage): void;
}

interface NetworkInformationLike {
  saveData?: boolean;
}

const defaultOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);
const defaultSaveData = () =>
  typeof navigator !== 'undefined' && !!(navigator as Navigator & { connection?: NetworkInformationLike }).connection?.saveData;
const defaultSupported = () =>
  typeof window !== 'undefined' && 'caches' in window && typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
const defaultStandalone = () => {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(display-mode: standalone)').matches;
  } catch {
    return false;
  }
};

const UNSUPPORTED: EngineOfflineStatus = { status: 'unsupported' };
const CHECKING: EngineOfflineStatus = { status: 'checking' };

export function useEngineOffline(options: UseEngineOfflineOptions = {}): EngineOfflineState {
  const optsRef = useRef(options);
  optsRef.current = options;
  const enabled = options.enabled ?? COMPUTER_ENABLED;
  const supported = enabled && (options.supported ?? defaultSupported());
  const [stage1, setStage1] = useState<EngineOfflineStatus>(supported ? CHECKING : UNSUPPORTED);
  const [stage2, setStage2] = useState<EngineOfflineStatus>(supported ? CHECKING : UNSUPPORTED);
  const states = useRef({ 1: stage1, 2: stage2 } as Record<EngineStage, EngineOfflineStatus>);
  states.current = { 1: stage1, 2: stage2 };
  const running = useRef<Record<EngineStage, AbortController | null>>({ 1: null, 2: null });
  const alive = useRef(true);
  const persisted = useRef(false);
  /** Stage 2 asked for by a tap (beyond `large` / standalone). */
  const [requested2, setRequested2] = useState(false);
  const wanted2 = supported && (!!options.large || requested2 || (options.standalone ?? defaultStandalone)());
  const want2 = useRef({ wanted: wanted2, requested: requested2 });
  want2.current = { wanted: wanted2, requested: requested2 };

  const setStage = useCallback((stage: EngineStage, s: EngineOfflineStatus) => {
    if (!alive.current) return;
    states.current = { ...states.current, [stage]: s };
    (stage === 1 ? setStage1 : setStage2)(s);
  }, []);

  /** Starts stage 2 when stage 1 is ready, stage 2 is wanted and was not looked at yet (Save-Data asks for a tap). */
  const startWanted2Ref = useRef<() => void>(() => undefined);

  const start = useCallback(
    (stage: EngineStage) => {
      if (running.current[stage]) return;
      const o = optsRef.current;
      const online = o.online ?? defaultOnline;
      if (!online()) {
        setStage(stage, { status: 'missing', reason: 'offline' });
        return;
      }
      const ctrl = new AbortController();
      running.current[stage] = ctrl;
      setStage(stage, { status: 'downloading', percent: 0 });
      const base = o.base ?? document.baseURI;
      downloadStage(stage, base, (percent) => setStage(stage, { status: 'downloading', percent }), ctrl.signal, o)
        .then(() => {
          setStage(stage, { status: 'ready' });
          if (stage === 1) startWanted2Ref.current();
          if (!persisted.current) {
            persisted.current = true;
            void (o.persist ?? (() => requestPersistence()))().catch(() => false);
          }
        })
        .catch(() => !ctrl.signal.aborted && setStage(stage, { status: 'missing', reason: online() ? 'failed' : 'offline' }))
        .finally(() => {
          if (running.current[stage] === ctrl) running.current[stage] = null;
        });
    },
    [setStage],
  );

  const download = useCallback(
    (stage: EngineStage = 1) => {
      if (!supported) return;
      if (stage === 2) {
        setRequested2(true);
        // Waits for stage 1; the effect below starts it then.
        if (states.current[1].status !== 'ready') return;
      }
      start(stage);
    },
    [supported, start],
  );

  /* ---- launch: check both stages, schedule stage 1 ---- */
  useEffect(() => {
    alive.current = true;
    if (!supported) return;
    const o = optsRef.current;
    const online = o.online ?? defaultOnline;
    const saveData = o.saveData ?? defaultSaveData;
    const base = o.base ?? document.baseURI;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Back online after the launch check or a download found the device offline.
    const onOnline = () => {
      if (saveData()) return;
      const s1 = states.current[1];
      if (s1.status === 'missing' && s1.reason === 'offline') start(1);
      const s2 = states.current[2];
      if (s2.status === 'missing' && s2.reason === 'offline' && states.current[1].status === 'ready') start(2);
    };
    window.addEventListener('online', onOnline);

    isStageCached(1, base, o)
      .then((cached) => {
        if (!alive.current) return;
        if (cached) return setStage(1, { status: 'ready' });
        if (!online()) return setStage(1, { status: 'missing', reason: 'offline' });
        if (saveData()) return setStage(1, { status: 'missing', reason: 'saveData' });
        timer = setTimeout(() => start(1), o.delayMs ?? ENGINE_DOWNLOAD_DELAY_MS);
      })
      .catch(() => setStage(1, UNSUPPORTED));
    isStageCached(2, base, o)
      .then((cached) => setStage(2, cached ? { status: 'ready' } : { status: 'missing', reason: 'idle' }))
      .catch(() => setStage(2, UNSUPPORTED));

    const ctrls = running.current;
    return () => {
      alive.current = false;
      clearTimeout(timer);
      window.removeEventListener('online', onOnline);
      for (const s of [1, 2] as const) {
        ctrls[s]?.abort();
        ctrls[s] = null;
      }
    };
  }, [supported, start, setStage]);

  /* ---- stage 2 on demand, once stage 1 is ready ---- */
  const startWanted2 = useCallback(() => {
    if (!alive.current || !want2.current.wanted || states.current[1].status !== 'ready') return;
    const s2 = states.current[2];
    if (s2.status !== 'missing' || s2.reason !== 'idle') return;
    const saveData = optsRef.current.saveData ?? defaultSaveData;
    if (saveData() && !want2.current.requested) {
      setStage(2, { status: 'missing', reason: 'saveData' });
      return;
    }
    start(2);
  }, [start, setStage]);
  startWanted2Ref.current = startWanted2;

  useEffect(() => {
    startWanted2();
  }, [wanted2, requested2, stage1.status, stage2, startWanted2]);

  const line = statusLine(stage1, stage2, !!options.large);
  return { stage1, stage2, line, download };
}
