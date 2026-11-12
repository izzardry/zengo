/**
 * The single stage (DESIGN 4, Ztyle 05): one route, one board that is always centered and never
 * moves. Start screen, game, scoring, hidden UI, review and overlays are states of this stage.
 *
 * | State          | Board                      | Chrome                                                |
 * |----------------|----------------------------|-------------------------------------------------------|
 * | start          | blurred preview            | StartChrome (header, footer, pill), language, version |
 * | start scrolled | blurred, scrolled away     | sticky header, history, back-to-top, support, credits |
 * | playing        | sharp, interactive         | Back, info pill, help, two strips, toolbar            |
 * | scoring        | sharp, dead stones marked  | as playing, the scoring bar in the toolbar's place    |
 * | UI hidden      | sharp                      | board and the two clocks only (tap empty stage)       |
 * | review         | sharp, read-only           | as playing, toolbar with stepping controls            |
 * | overlay        | behind the scrim           | game-over overlay, tutorial, donation                 |
 *
 * Game state lives in `useGameState` (package 1B); this file only wires packages together: the Go
 * board (1A), the game chrome (1C), the start screen (1D), history, tutorial and the live-region
 * texts (1E), the clock (1F, 2B), and the engine (2A) with the computer's turn, the hint bulb, the
 * territory preview, the blunder guard and the dead-stone proposal (2C). All of them share the one
 * engine of `useZigoEngine`.
 *
 * Pass-and-play and the computer play end to end. `ROOM` answers Start with a `Coming soon` toast
 * (`PLAYABLE_MODES`) until milestone 3 adds the room chrome.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { toast } from 'sonner';
import { BOARD_SIZE_LANDSCAPE, BOARD_SIZE_PORTRAIT, GoBoard, useGoBoardGame } from '@/components/board';
import {
  GameOverOverlay,
  InfoPill,
  PageTint,
  PassUndoToast,
  PlayerStrip,
  ResignUndoToast,
  ScoringAccept,
  ScoringBar,
  StatusBar,
  TINT_MS,
  outcomeFor,
  tintFor,
  useShare,
  type InfoOpponent,
  type ToolbarMode,
} from '@/components/game';
import {
  DonationPrompt,
  EngineCredit,
  GameHistory,
  InstallButton,
  IzzardryFooter,
  LanguageSwitcher,
  PWAInstallPrompt,
  SupportButton,
  TutorialOverlay,
  newAtariAnnouncements,
  plyAnnouncement,
} from '@/components/platform';
import { BoardPreview, EngineStatus, StartChrome, StartPill, useScrolled } from '@/components/start';
import { useIsMobileLandscape } from '@/hooks/use-orientation';
import { useBlunderGuard } from '@/hooks/useBlunderGuard';
import { useClock } from '@/hooks/useClock';
import { useComputer, useEngineStart } from '@/hooks/useComputer';
import { DONATION_DELAY_MS, useDonationPrompt } from '@/hooks/useDonationPrompt';
import { useEngineOffline } from '@/hooks/useEngineOffline';
import { useGameState } from '@/hooks/useGameState';
import { useHelpers } from '@/hooks/useHelpers';
import { useHint } from '@/hooks/useHint';
import { usePWAInstall } from '@/hooks/usePWAInstall';
import { useSavedGames } from '@/hooks/useSavedGames';
import { useSeating } from '@/hooks/useSeating';
import { useSWUpdate } from '@/hooks/useSWUpdate';
import { useTutorial } from '@/hooks/useTutorial';
import { useZigoEngine } from '@/hooks/useZigoEngine';
import { withSpokenLabels } from '@/lib/clock';
import { flags } from '@/lib/flags';
import { DEFAULT_LEVEL, opponentOf } from '@/lib/gameRecord';
import { useI18n } from '@/lib/i18n';
import { needsLargeNet } from '@/lib/levels';
import { createDeadStoneProposer } from '@/lib/proposal';
import scoringApi from '@/lib/scoring';
import { bankTurn, bankedTurnMs } from '@/lib/turnBank';
import type { Color, Game, IllegalReason, Point, SavedGame } from '@/lib/types';
import { cn } from '@/lib/utils';
import { formatTc, isPass, parseTc } from '@/lib/zigo';
import {
  ENGINE_ON,
  PLAYABLE_MODES,
  SWIPE_MIN_PX,
  TRANSITION_MS,
  allMoves,
  engineStartBlocked,
  firstColor,
  nearColor,
  opponentPassed,
  other,
  passedBadges,
  rankLabel,
  reviewClockView,
  totalTime,
} from './stage';

const NO_SCORE: readonly [number, number] = Object.freeze([0, 0] as const);

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
}

export default function Index() {
  const { t } = useI18n();
  // The one engine (DESIGN 10.1): computer moves, hints, the guard and the scoring proposal.
  const engine = useZigoEngine();
  const engineRef = useRef(engine);
  engineRef.current = engine;
  // The dead-stone proposal when a game enters scoring (DESIGN 8.4), in every solo mode.
  const proposeDead = useMemo(() => (ENGINE_ON ? createDeadStoneProposer(() => engineRef.current) : undefined), []);
  const gs = useGameState({ proposeDead });
  const saved = useSavedGames();
  const { helpers, toggleHelpers } = useHelpers();
  const { seating, toggleSeating } = useSeating();
  const landscape = useIsMobileLandscape();
  const { shareLink, copySgf } = useShare();
  const { shouldShowPrompt, canInstall, install, dismiss: dismissInstall } = usePWAInstall();
  const { showTutorial, startTutorial, forceShowTutorial, completeTutorial } = useTutorial();
  const { showPrompt: showDonation, triggerPrompt: triggerDonation, dismissPrompt: dismissDonation } = useDonationPrompt();

  const { phase, session, view } = gs;
  const isStart = phase === 'start';
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const gsRef = useRef(gs);
  gsRef.current = gs;
  const { checkForUpdate } = useSWUpdate({ shouldAutoReload: () => phaseRef.current === 'start' });
  // Offline copy of the engine (DESIGN 14): stage 1 on the first launch, stage 2 once a level 8–12
  // is selected (or played).
  const shownOpponent = session ? null : gs.startPill.saved ? opponentOf(gs.startPill.saved) : gs.opponent;
  const largeWanted = session
    ? session.mode === 'computer' && needsLargeNet(session.level ?? DEFAULT_LEVEL)
    : shownOpponent?.mode === 'computer' && needsLargeNet(shownOpponent.level);
  const engineOffline = useEngineOffline({ large: largeWanted });
  const engineOfflineRef = useRef(engineOffline);
  engineOfflineRef.current = engineOffline;

  const scrolled = useScrolled(50, isStart);
  const [showUI, setShowUI] = useState(true);
  const [animating, setAnimating] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [ghost, setGhost] = useState<Point | null>(null);

  /* ---- start ⇄ game transition: the board stays put, only the blur and the chrome animate ---- */
  const animTimer = useRef<ReturnType<typeof setTimeout>>();
  const animate = useCallback(() => {
    setAnimating(true);
    clearTimeout(animTimer.current);
    animTimer.current = setTimeout(() => setAnimating(false), TRANSITION_MS);
  }, []);
  useEffect(() => () => clearTimeout(animTimer.current), []);

  // Entering a game from anywhere (Start, history card, overlay): show the chrome, unflip, top of page.
  const sessionId = session?.id ?? null;
  useEffect(() => {
    setShowUI(true);
    setFlipped(false);
    setGhost(null);
    if (sessionId && typeof window !== 'undefined' && window.scrollY !== 0) window.scrollTo({ top: 0, behavior: 'auto' });
  }, [sessionId]);

  /* ---- game over: overlay only when the game ends while it is being played ---- */
  const [overlay, setOverlay] = useState(false);
  const [endedHere, setEndedHere] = useState(false);
  const prevEnd = useRef<{ id: string | null; ended: boolean }>({ id: null, ended: false });
  const ended = !!session?.game.end;
  useEffect(() => {
    const prev = prevEnd.current;
    prevEnd.current = { id: sessionId, ended };
    if (sessionId !== prev.id) {
      setOverlay(false);
      setEndedHere(false);
      return;
    }
    if (ended && !prev.ended) {
      setOverlay(true);
      setEndedHere(true);
      // The one-time donation prompt follows the first win, 1.5 s after the overlay (DESIGN 8.5).
      const s = sessionRef.current;
      if (s?.game.end && outcomeFor(s.game.end.result, s.mode, s.color) === 'win') triggerDonation(TINT_MS + DONATION_DELAY_MS);
    } else if (!ended) {
      setOverlay(false);
      setEndedHere(false);
    }
  }, [sessionId, ended, triggerDonation]);

  /* ---- resign with a 5-second undo (DESIGN 8.3) ---- */
  const [resigned, setResigned] = useState<'you' | Color | null>(null);
  useEffect(() => {
    if (!ended) setResigned(null);
  }, [ended]);

  /* ---- the clock (DESIGN 11): performance.now() stamps, paused on Back, a hidden tab and scoring ---- */
  const sessionGame = session?.game ?? null;
  const { timeout } = gs;
  // Time already spent on this turn before a reload or Back → Resume (lib/turnBank).
  const banked = useRef<{ id: string | null; ms: number }>({ id: null, ms: 0 });
  if (banked.current.id !== sessionId) {
    banked.current = { id: sessionId, ms: session && session.mode !== 'room' ? bankedTurnMs(session.id, session.game) : 0 };
  }
  // A move-list jump in a live game (review) does not stop the clock: solo clocks pause only when
  // the tab is hidden or on Back (DESIGN 11), and Back leaves the game (phase `start`).
  const clock = useClock(sessionGame, session?.tc ?? null, {
    active: phase !== 'start',
    key: sessionId,
    onFlag: timeout,
    initialTurnMs: banked.current.ms,
  });
  const clockRef = useRef(clock);
  clockRef.current = clock;
  const mode = session?.mode ?? 'local';

  /* ---- engine trouble: one calm toast with Try again (DESIGN 10.1) ---- */
  const engineFailed = useCallback(
    (retry?: () => void) => {
      toast(t(isOnline() ? 'engine.failed' : 'engine.failedOffline'), {
        id: 'engine-failed',
        action: retry ? { label: t('engine.retry'), onClick: retry } : undefined,
      });
    },
    [t],
  );

  /* ---- the computer's turn (DESIGN 10) ---- */
  const computerRetry = useRef<() => void>(() => {});
  const computer = useComputer({
    engine,
    game: sessionGame,
    // The computer plays on while the player looks back through the moves.
    enabled: ENGINE_ON && mode === 'computer' && phase !== 'start',
    computerColor: session ? other(session.color) : null,
    level: session?.level ?? DEFAULT_LEVEL,
    tc: session?.tc ?? null,
    onMove: (p, ms) => void (isPass(p) ? gsRef.current.pass(ms) : gsRef.current.play(p, ms)),
    onResign: (result) => void gsRef.current.finish(result),
    onFail: () => engineFailed(() => computerRetry.current()),
    elapsed: clock.elapsed,
    sessionKey: sessionId,
  });
  computerRetry.current = computer.retry;

  // A solo game warms the engine up, so hints, the guard and the proposal answer at once: against
  // the computer always, in pass-and-play once stage 1 is on the device (no download for a hint
  // nobody asked for).
  const stage1Cached = engineOffline.stage1.status === 'ready';
  const warm = ENGINE_ON && !!sessionGame && !sessionGame.end && (mode === 'computer' || (mode === 'local' && stage1Cached));
  const engineIdle = engine.state === 'idle';
  useEffect(() => {
    if (warm && engineIdle) engineRef.current.load(1).catch(() => undefined);
  }, [warm, engineIdle]);

  /* ---- hint bulb and territory preview: computer and pass-and-play (DESIGN 7.3) ---- */
  const hintEnabled = ENGINE_ON && flags.hint && (mode === 'computer' || mode === 'local') && phase === 'playing' && gs.isPlayerTurn;
  const hint = useHint({
    engine,
    game: sessionGame,
    enabled: hintEnabled,
    available: engine.state === 'ready' || (engine.state !== 'failed' && stage1Cached),
    onAssisted: gs.markAssisted,
    onFail: () => engineFailed(),
    onUnavailable: () => toast(t('assist.previewNeedsEngine'), { id: 'preview-engine' }),
    sessionKey: sessionId,
  });

  /* ---- blunder guard: against the computer, helpers on (DESIGN 7.2) ---- */
  const guard = useBlunderGuard({
    engine,
    game: sessionGame,
    enabled: ENGINE_ON && flags.blunderGuard && mode === 'computer' && helpers && phase === 'playing',
    playerColor: session?.color ?? null,
    onAssisted: gs.markAssisted,
    sessionKey: sessionId,
  });
  const guardRef = useRef(guard);
  guardRef.current = guard;

  /* ---- screen-reader notes of the assistance: a refused stone, a pass hint, the preview's lead ---- */
  const [assistNote, setAssistNote] = useState('');
  const livePlies = sessionGame?.plies;
  const liveCursor = sessionGame?.cursor;
  useEffect(() => setAssistNote(''), [sessionId, livePlies, liveCursor]);
  const { passBest, step: hintStep } = hint;
  useEffect(() => {
    if (!passBest || hintStep === 0) return;
    // A pass has no point to pulse: say it (DESIGN 7.3).
    toast(t('assist.hintPass'), { id: 'hint-pass' });
    setAssistNote(t('assist.hintPass'));
  }, [passBest, hintStep, t]);
  const previewNote = hint.preview?.note ?? null;
  const previewOwnership = hint.preview?.ownership ?? null;
  useEffect(() => {
    if (!previewNote) return;
    setAssistNote(t(previewNote.startsWith('B') ? 'assist.previewLead.B' : 'assist.previewLead.W', { points: previewNote.slice(2) }));
  }, [previewNote, t]);

  /** Keeps the running turn's time for a reload or a later resume. */
  const bankNow = useCallback(() => {
    const s = sessionRef.current;
    if (!s || s.mode === 'room' || s.game.end) return;
    bankTurn(s.id, s.game, clockRef.current.elapsed());
  }, []);
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') bankNow();
    };
    window.addEventListener('pagehide', bankNow);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', bankNow);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [bankNow]);

  /* ---- pass with a 5-second undo (DESIGN 6.2) ---- */
  const [passToast, setPassToast] = useState<{ who: 'you' | Color; cursor: number; key: number } | null>(null);
  useEffect(() => setPassToast(null), [sessionId]);

  /* ---- start-screen settings (StartChrome shows a saved game's own, dimmed) ---- */
  const pillSaved = gs.startPill.saved;
  const startClock = useMemo(() => parseTc(gs.tc), [gs.tc]);

  const comingSoon = useCallback(() => toast(t('comingSoon'), { id: 'coming-soon' }), [t]);

  /* ---- actions ---- */
  const begin = useCallback(
    (run: () => boolean) => {
      animate();
      const ok = run();
      if (!ok) setAnimating(false);
      return ok;
    },
    [animate],
  );

  /* ---- Start: a computer game waits for the engine (spinner with progress, DESIGN 10.1, 14) ---- */
  const handleStartRef = useRef<() => Promise<void>>(async () => undefined);
  const engineStart = useEngineStart(engine, { onFail: () => engineFailed(() => void handleStartRef.current()) });
  const { cancel: cancelEngineStart, prepare: prepareEngine } = engineStart;
  useEffect(() => {
    if (!isStart) cancelEngineStart();
  }, [isStart, cancelEngineStart]);

  const handleStart = useCallback(async () => {
    const pill = gs.startPill;
    const target = pill.saved ? opponentOf(pill.saved) : gs.opponent;
    // Rooms (milestone 3): a stored game can still be reviewed.
    if (pill.label !== 'review' && !PLAYABLE_MODES[target.mode]) {
      comingSoon();
      return;
    }
    if (pill.label !== 'review' && target.mode === 'computer') {
      // Offline without the networks of this level: nothing happens; the status line says why.
      const off = engineOfflineRef.current;
      if (engineStartBlocked(target.level, isOnline(), off.stage1, off.stage2, engineRef.current.nets)) return;
      if (!(await prepareEngine(target.level))) return;
      // The player went elsewhere meanwhile (a history card, a link).
      if (phaseRef.current !== 'start') return;
    }
    if (!begin(gsRef.current.start)) {
      comingSoon();
      return;
    }
    if (pill.label === 'start') startTutorial();
  }, [gs.startPill, gs.opponent, prepareEngine, begin, comingSoon, startTutorial]);
  handleStartRef.current = handleStart;

  const handleOpen = useCallback(
    (g: SavedGame) => {
      const finished = !!g.result;
      if (!finished && !PLAYABLE_MODES[g.mode]) {
        comingSoon();
        return;
      }
      if (!begin(() => gs.open(g))) comingSoon();
    },
    [begin, gs, comingSoon],
  );

  const handleExit = useCallback(() => {
    animate();
    setResigned(null);
    setPassToast(null);
    // The clock pauses on Back and resumes with this turn's time on return (DESIGN 11).
    bankNow();
    gs.exit();
  }, [animate, gs, bankNow]);

  const handleNewGame = useCallback(() => {
    setOverlay(false);
    gs.newGame();
  }, [gs]);

  const handleResign = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    const who: 'you' | Color = s.mode === 'local' ? s.game.turn : 'you';
    if (gsRef.current.resign()) {
      setPassToast(null);
      setResigned(who);
    }
  }, []);

  const handleUndoResign = useCallback(() => {
    gs.reopen();
    setResigned(null);
  }, [gs]);

  /** A stone placed on the board (tap, confirmed ghost, keyboard, typed `D4`): through the blunder guard against the computer. */
  const handlePlay = useCallback(
    (p: Point) => {
      const g = guardRef.current;
      if (!g.active) {
        gsRef.current.play(p, clockRef.current.elapsed());
        return;
      }
      void g.check(p).then((r) => {
        if (r.action === 'commit') gsRef.current.play(p, clockRef.current.elapsed());
        else if (r.action === 'refuse') setAssistNote(t('assist.blunderRefused'));
      });
    },
    [t],
  );

  /** The flag's tap, or `pass` typed: a pass with its 5-second undo toast. */
  const handlePass = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    const who: 'you' | Color = s.mode === 'local' ? s.game.turn : 'you';
    if (!gsRef.current.pass(clockRef.current.elapsed())) return;
    const cursor = s.game.cursor + 1;
    setPassToast((prev) => ({ who, cursor, key: (prev?.key ?? 0) + 1 }));
  }, []);

  const handleUndoPass = useCallback(() => {
    gsRef.current.undoPass();
    setPassToast(null);
  }, []);

  /* ---- ko and superko: one toast the first time per game, helpers on (DESIGN 6.1) ---- */
  const illegalToasted = useRef(new Set<string>());
  const handleIllegal = useCallback(
    (_p: Point, reason: IllegalReason) => {
      if (reason !== 'ko' && reason !== 'superko') return;
      const key = `${sessionRef.current?.id ?? ''}:${reason}`;
      if (illegalToasted.current.has(key)) return;
      illegalToasted.current.add(key);
      toast(t(reason === 'ko' ? 'stage.ko' : 'stage.superko'), { id: 'illegal' });
    },
    [t],
  );

  const handleShare = useCallback(() => {
    const s = sessionRef.current;
    const url = gsRef.current.shareUrl();
    const end = s?.game.end;
    const won = !!end && s?.mode === 'computer' && outcomeFor(end.result, s.mode, s.color) === 'win';
    void shareLink(url, won ? 'win' : 'solo', s?.level);
  }, [shareLink]);

  const handleCopySgf = useCallback(() => {
    const text = gsRef.current.sgf();
    if (text) void copySgf(text);
  }, [copySgf]);

  const handleContinue = useCallback(() => {
    if (!begin(gs.continueFromHere)) comingSoon();
  }, [begin, gs, comingSoon]);

  /* ---- keyboard: Z / Shift+Z undo and redo; ← / → step in review (DESIGN 6.1, 12.3) ---- */
  useEffect(() => {
    if (isStart) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(e.target)) return;
      const inGrid = e.target instanceof Element && !!e.target.closest('[role="grid"],[role="menu"],[role="dialog"]');
      const key = e.key;
      const g = gsRef.current;
      if (key === 'z' || key === 'Z') {
        e.preventDefault();
        if (phase === 'review') g.step(e.shiftKey ? 1 : -1);
        else if (e.shiftKey) g.redo();
        else g.undo();
      } else if (phase === 'review' && !inGrid && (key === 'ArrowLeft' || key === 'ArrowRight')) {
        e.preventDefault();
        g.step(key === 'ArrowLeft' ? -1 : 1);
      } else if (phase === 'review' && !inGrid && (key === 'Home' || key === 'End')) {
        e.preventDefault();
        if (key === 'Home') g.toStart();
        else g.toEnd();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isStart, phase]);

  /* ---- review: a horizontal swipe on the board steps (DESIGN 12.3) ---- */
  const swipe = useRef<{ x: number; y: number; id: number } | null>(null);
  const onSwipeDown = (e: PointerEvent<HTMLDivElement>) => {
    if (phase !== 'review') return;
    swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onSwipeUp = (e: PointerEvent<HTMLDivElement>) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || s.id !== e.pointerId || phase !== 'review') return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.5) gs.step(dx < 0 ? 1 : -1);
  };

  /* ---- tap on empty stage toggles the chrome (DESIGN 4) ---- */
  const onStageClick = (e: MouseEvent<HTMLDivElement>) => {
    if (isStart || e.target !== e.currentTarget) return;
    setShowUI((v) => !v);
  };

  /* ---- polite live region (DESIGN 14.1): `Black: D4, captures 2`, `White passes`, atari ---- */
  const [liveText, setLiveText] = useState('');
  const announced = useRef<{ id: string | null; game: Game | null }>({ id: null, game: null });
  useEffect(() => {
    const prev = announced.current;
    announced.current = { id: sessionId, game: view };
    if (!view || !session || prev.id !== sessionId || !prev.game || prev.game === view) return;
    const ply = plyAnnouncement(t, prev.game, view);
    if (!ply) return;
    const parts = [ply];
    // Atari is part of the helpers bundle (DESIGN 7.1): announced with the ring it stands for.
    if (helpers) {
      const c = view.turn;
      const owner: Color | 'you' = session.mode !== 'local' && c === session.color ? 'you' : c;
      parts.push(...newAtariAnnouncements(t, prev.game, view, c, owner));
    }
    setLiveText(parts.join('. '));
  }, [view, session, sessionId, helpers, t]);
  useEffect(() => {
    if (isStart) setLiveText('');
  }, [isStart]);

  /* ---- derived view ---- */
  const boardGame = isStart || !view ? gs.preview : view;
  const boardProps = useGoBoardGame(boardGame);
  const near: Color = session ? (flipped ? other(nearColor(session)) : nearColor(session)) : 'B';
  const far = other(near);
  const faceToFace = !!session && mode === 'local' && seating === 'face' && (phase === 'playing' || phase === 'scoring');
  const live = !!session && !session.game.end;
  const scoringNow = phase === 'scoring' && live;
  const interactive = live && ((phase === 'playing' && gs.isPlayerTurn) || (scoringNow && gs.scoring.editable));
  const chromeVisible = !isStart && showUI;
  const toolbarMode: ToolbarMode = phase === 'review' ? 'review' : mode;
  const boardSize = landscape ? BOARD_SIZE_LANDSCAPE : BOARD_SIZE_PORTRAIT;

  // The ghost previews `D4?` only while it can be placed.
  useEffect(() => {
    if (!interactive || scoringNow) setGhost(null);
  }, [interactive, scoringNow]);

  // Scoring layer: live scoring, and the final position of a scored game (review, after Accept).
  const sc = gs.scoring;
  const boardScoring = useMemo(
    () => (!isStart && sc.active && sc.territory ? { dead: sc.dead, territory: sc.territory } : null),
    [isStart, sc.active, sc.dead, sc.territory],
  );
  const finalScore = useMemo(() => {
    const g = session?.game;
    if (!g?.end || g.end.result.by !== 'score' || !g.scoring) return undefined;
    return scoringApi.score(g, g.scoring.dead);
  }, [session?.game]);

  const reviewFaces = useMemo(
    () => (phase === 'review' && view && session ? reviewClockView(view, session.tc) : null),
    [phase, view, session],
  );
  // Review faces bypass useClock: give byo-yomi faces their spoken reading here (DESIGN 14.1).
  const faces = reviewFaces ? withSpokenLabels(reviewFaces, t) : clock;
  const moves = useMemo(() => (session ? allMoves(session.game) : []), [session]);
  const passed = useMemo(() => (view ? passedBadges(view) : { B: false, W: false }), [view]);

  /* ---- scoring bar (DESIGN 8.4): one Accept side by side, one per player face to face ---- */
  const acceptFor = useCallback((side?: Color) => void gsRef.current.scoring.accept(side), []);
  const scoringBar = scoringNow ? (
    <ScoringBar
      onResume={() => void gsRef.current.scoring.resume()}
      onAccept={() => acceptFor(faceToFace ? near : undefined)}
      accepted={faceToFace ? sc.acceptedBy[near] : false}
      side={faceToFace ? near : undefined}
      disabled={!sc.editable}
      visible={chromeVisible}
      landscape={landscape}
    />
  ) : undefined;
  const farAccept =
    scoringNow && faceToFace ? (
      <ScoringAccept variant="compact" side={far} accepted={sc.acceptedBy[far]} onAccept={() => acceptFor(far)} />
    ) : undefined;

  const strip = (color: Color, rotated: boolean, layout: 'row' | 'rail') =>
    session && view ? (
      <PlayerStrip
        color={color}
        prisoners={view.prisoners[color]}
        komi2={view.settings.komi2}
        passed={passed[color]}
        clock={faces[color]}
        active={!view.end && view.turn === color}
        score={sc.active && sc.score ? sc.score : undefined}
        action={color === far ? farAccept : undefined}
        rotated={rotated}
        details={showUI}
        layout={layout}
      />
    ) : null;

  // A room game reviewed from history reads the room score from the stored room record (DESIGN 9).
  const reviewedRoom = session?.mode === 'room' ? saved.rooms.find((r) => r.code === session.code) : undefined;
  const roomScore: readonly [number, number] = reviewedRoom
    ? [reviewedRoom.score[reviewedRoom.seat] / 2, reviewedRoom.score[reviewedRoom.seat === 0 ? 1 : 0] / 2]
    : NO_SCORE;
  const infoOpponent: InfoOpponent =
    mode === 'computer' ? { kind: 'computer', level: session?.level ?? 5 } : mode === 'room' ? { kind: 'room', score: roomScore } : { kind: 'local' };
  const info =
    session && view ? (
      <InfoPill
        code={session.code}
        opponent={infoOpponent}
        moves={moves}
        size={view.settings.size}
        cursor={view.cursor}
        firstColor={firstColor(view)}
        ghost={ghost}
        note={
          previewNote ? (
            // The engine's score lead while the territory preview is held (DESIGN 7.3); spoken by the assist region.
            <span aria-hidden="true" data-testid="preview-note">
              {previewNote}
            </span>
          ) : undefined
        }
        onJump={gs.goto}
        visible={chromeVisible}
        landscape={landscape}
        placement={landscape ? 'inline' : 'fixed'}
      />
    ) : null;

  const end = session?.game.end;
  const tint = end && endedHere && session ? tintFor(end.result, session.mode, session.color) : null;
  const flagLive = phase === 'playing' && live && gs.isPlayerTurn;

  /* ---- hint bulb in the toolbar: tap best / top three, hold 1 s territory (DESIGN 4.2, 7.3) ---- */
  const hintControls =
    ENGINE_ON && flags.hint && session && (mode === 'computer' || mode === 'local') && phase === 'playing' && live
      ? {
          onHint: hint.tap,
          onPeekStart: hint.previewStart,
          onPeekEnd: hint.previewEnd,
          busy: hint.pending || hint.previewPending,
          disabled: !hintEnabled,
        }
      : undefined;
  const boardHint = phase === 'playing' ? hint.hint : null;
  const territoryPreview = useMemo(
    () => (phase === 'playing' && previewOwnership ? { ownership: previewOwnership } : null),
    [phase, previewOwnership],
  );
  const startRank = shownOpponent?.mode === 'computer' ? rankLabel(shownOpponent.level) : null;

  return (
    <>
      {/* `isolate`: the stage root is the stacking context of the page tint's `-z-10` layer, so the
          tint paints over the root's background (and html/body's) but under the stage (DESIGN 8.5). */}
      <div className={cn('halftone-bg relative isolate select-none', isStart ? 'min-h-[100dvh]' : 'h-[100dvh] overflow-hidden')}>
        <PageTint tint={tint} />

        {/* ---- the stage: board always centered ---- */}
        <main
          aria-label="Zigo"
          onClick={onStageClick}
          data-testid="stage"
          data-phase={phase}
          data-engine={engine.state}
          data-computer={computer.thinking ? 'thinking' : undefined}
          data-size={boardGame.settings.size}
          className={cn(
            'flex h-[100dvh] min-h-[320px] items-center justify-center',
            landscape
              ? 'px-4 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]'
              : 'px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]',
          )}
        >
          <BoardPreview
            blurred={isStart}
            animate={animating}
            overlay={
              <StartPill
                label={gs.startPill.label}
                onClick={() => void handleStart()}
                loading={engineStart.loading}
                onCancel={cancelEngineStart}
                progress={engineStart.progress}
                disabled={!isStart || animating}
              />
            }
            overlayVisible={isStart}
          >
            <div className="relative" onPointerDown={onSwipeDown} onPointerUp={onSwipeUp} onPointerCancel={() => (swipe.current = null)}>
              {!isStart && !landscape && <div className="absolute inset-x-0 bottom-full mb-1 px-1">{strip(far, faceToFace, 'row')}</div>}
              <GoBoard
                {...boardProps}
                helpers={helpers}
                interactive={interactive}
                onPlay={handlePlay}
                onIllegal={handleIllegal}
                onPass={handlePass}
                onGhostChange={setGhost}
                scoring={boardScoring}
                onToggleGroup={sc.toggle}
                hint={boardHint}
                territoryPreview={territoryPreview}
                blunder={guard.blunder}
                blunderKey={guard.blunderKey}
                seating={faceToFace ? 'face' : 'side'}
                farColor={faceToFace ? far : null}
                announce={false}
                boardSize={boardSize}
              />
              {!isStart && !landscape && <div className="absolute inset-x-0 top-full mt-1 px-1">{strip(near, false, 'row')}</div>}
            </div>
          </BoardPreview>
        </main>

        {/* ---- game chrome ---- */}
        {session && (
          <>
            {landscape ? (
              <div
                // Left rail (DESIGN 4): centered in the height below the Back button.
                className={cn(
                  'pointer-events-none fixed z-chrome left-[max(1rem,env(safe-area-inset-left))]',
                  'top-[calc(max(1.5rem,env(safe-area-inset-top))+3.25rem)] bottom-[max(1rem,env(safe-area-inset-bottom))]',
                  'flex flex-col items-center justify-center gap-3 [&>*]:pointer-events-auto',
                )}
              >
                {/* Face to face, the far player's strip and clock are drawn rotated here too (DESIGN 5.2). */}
                {strip(far, faceToFace, 'rail')}
                <div
                  aria-hidden={chromeVisible ? undefined : true}
                  className={cn(
                    'transition-all duration-chrome ease-out',
                    chromeVisible ? 'opacity-100' : 'pointer-events-none -translate-x-8 opacity-0',
                  )}
                >
                  {info}
                </div>
                {strip(near, false, 'rail')}
              </div>
            ) : (
              info
            )}

            <StatusBar
              mode={toolbarMode}
              visible={chromeVisible}
              landscape={landscape}
              onBack={handleExit}
              onHelp={forceShowTutorial}
              onHelpHold={flags.donationPrompt ? () => triggerDonation() : undefined}
              canUndo={phase === 'review' ? gs.canStepBack : gs.canUndo}
              canRedo={phase === 'review' ? gs.canStepForward : gs.canRedo}
              onUndo={phase === 'review' ? () => gs.step(-1) : () => void gs.undo()}
              onRedo={phase === 'review' ? () => gs.step(1) : () => void gs.redo()}
              onUndoHold={gs.toStart}
              onRedoHold={gs.toEnd}
              helpers={helpers}
              onToggleHelpers={toggleHelpers}
              hint={hintControls}
              seating={mode === 'local' ? seating : undefined}
              onToggleSeating={mode === 'local' ? toggleSeating : undefined}
              onFlip={() => setFlipped((f) => !f)}
              onPass={handlePass}
              onResign={handleResign}
              opponentPassed={!!view && flagLive && opponentPassed(view)}
              flagDisabled={!flagLive}
              onContinue={phase === 'review' ? handleContinue : undefined}
              onShare={handleShare}
              onCopySgf={handleCopySgf}
              scoringBar={scoringBar}
            />
          </>
        )}

        {session && end && (
          <GameOverOverlay
            open={overlay && !resigned}
            result={end.result}
            mode={session.mode}
            myColor={session.color}
            code={session.code}
            size={session.game.settings.size}
            level={session.level}
            plies={session.game.cursor}
            durationMs={totalTime(session.game, session.tc)}
            score={finalScore}
            onShare={handleShare}
            onCopySgf={handleCopySgf}
            onPrimary={handleNewGame}
            onDismiss={() => setOverlay(false)}
          />
        )}

        {session && (
          <ResignUndoToast
            open={!!resigned && !!end}
            who={resigned ?? 'you'}
            onUndo={handleUndoResign}
            onExpire={() => setResigned(null)}
            placement={landscape ? 'rail' : 'game'}
          />
        )}

        {session && passToast && (
          <PassUndoToast
            key={passToast.key}
            open={!resigned && gs.canUndoPass && session.game.cursor === passToast.cursor}
            who={passToast.who}
            onUndo={handleUndoPass}
            onExpire={() => setPassToast(null)}
            placement={landscape ? 'rail' : 'game'}
          />
        )}

        {/* ---- start-screen chrome ---- */}
        <StartChrome
          visible={isStart}
          scrolled={scrolled}
          landscape={landscape}
          code={gs.code}
          onCodeChange={(code) => void gs.setCode(code)}
          opponent={gs.opponent}
          onOpponentChange={gs.setOpponent}
          opponentRank={startRank}
          color={gs.colorChoice}
          onColorChange={gs.setColorChoice}
          size={gs.size}
          onSizeChange={gs.setSize}
          rules={gs.rules}
          onRulesChange={gs.setRules}
          handicap={gs.handicap}
          onHandicapChange={gs.setHandicap}
          clock={startClock}
          onClockChange={(tc) => gs.setTc(formatTc(tc))}
          saved={pillSaved}
          busy={animating}
          showChevron={saved.games.length > 0}
          engineStatus={<EngineStatus line={engineOffline.line} onDownload={engineOffline.download} />}
          footerExtra={canInstall ? <InstallButton onClick={() => void install()} /> : undefined}
          onVersionTap={() => void checkForUpdate()}
        />

        <div
          className={cn(
            'fixed z-chrome top-[max(1.5rem,env(safe-area-inset-top))] right-[max(1rem,env(safe-area-inset-right))]',
            'transition-all duration-500 ease-out',
            isStart && !scrolled ? 'scale-100 opacity-100' : 'pointer-events-none scale-90 opacity-0',
          )}
          aria-hidden={isStart && !scrolled ? undefined : true}
        >
          <LanguageSwitcher />
        </div>

        {/* ---- below the fold: history, support, credits ---- */}
        {isStart && (
          <section aria-label={t('platform.history.title')} className="relative min-h-[60dvh] pb-[max(2rem,env(safe-area-inset-bottom))]">
            <GameHistory
              games={saved.games}
              rooms={saved.rooms}
              onOpen={handleOpen}
              onDelete={(g) => void saved.remove(g.id)}
              onRestore={(g) => saved.restore(g)}
              isVisible={scrolled}
            />
            <div
              className={cn(
                'flex flex-col items-center gap-4 pt-10 transition-opacity duration-300',
                scrolled ? 'opacity-100' : 'pointer-events-none opacity-0',
              )}
            >
              <SupportButton size="lg" />
              <EngineCredit />
              <IzzardryFooter />
            </div>
          </section>
        )}

        {shouldShowPrompt && isStart && <PWAInstallPrompt onInstall={() => void install()} onDismiss={dismissInstall} />}

        {showTutorial && session && !isStart && (
          <TutorialOverlay onDismiss={completeTutorial} mode={session.mode} size={session.game.settings.size} isLandscape={landscape} />
        )}

        {/* Moves, passes, captures and atari for screen readers (DESIGN 14.1). */}
        <div aria-live="polite" aria-atomic className="sr-only" data-testid="board-live">
          {liveText}
        </div>
        {/* Screen-reader notes of the hint and the blunder guard (the guard shows no text, DESIGN 7.2). */}
        <div aria-live="polite" aria-atomic className="sr-only" data-testid="assist-live">
          {assistNote}
        </div>

        <DonationPrompt open={showDonation} onDismiss={dismissDonation} />
      </div>
    </>
  );
}
