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
 * Rooms (DESIGN 9, milestone 3): `useGameState` runs the room (`gs.room`, `useRoom` over the room
 * controller) and derives the session from it. This file adds the room chrome: the presence dot
 * and the score in the info pill, the toolbar's room column (takeback request, no redo, no hint,
 * tap pass / hold resign, Share opens the invite sheet), the room scoring bar with the opponent's
 * toggles flashing on the board, the invite and manual-connection sheets, the request and presence
 * toasts, the tab-guard banner, the clock in external mode with the controller's stamps, and the
 * overlay's Rematch. The room's scoring proposal comes from this device's engine through the same
 * `createDeadStoneProposer` as solo play; the controller sends it as data (DESIGN 9.5, PLAN 7).
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
import {
  InviteSheet,
  ManualConnectSheet,
  PresenceDot,
  RoomBanner,
  RoomScoringBar,
  RoomToasts,
  ToggleFlash,
  shouldOfferInvite,
  waitsAsAnchor,
} from '@/components/room';
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
import { DEFAULT_LEVEL, opponentOf, undoPassIndex } from '@/lib/gameRecord';
import { useI18n } from '@/lib/i18n';
import { needsLargeNet } from '@/lib/levels';
import { createDeadStoneProposer } from '@/lib/proposal';
import scoringApi from '@/lib/scoring';
import { bankTurn, bankedTurnMs } from '@/lib/turnBank';
import type { Color, Game, IllegalReason, LockReason, Opponent, Point, SavedGame } from '@/lib/types';
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

/** A paused room turn before the controller has loaded. */
const NO_TURN = Object.freeze({ turnStart: null, turnUsed: 0 });

/** Board locks that also forbid resigning (resignation works offline, DESIGN 9.3). */
const HARD_LOCKS: ReadonlySet<LockReason> = new Set<LockReason>(['other-tab', 'version', 'denied', 'no-seat']);

/** Resigning is possible in this room state: seated and not hard-locked (also on the opponent's turn and offline). */
function roomResignable(rs: { seat: 0 | 1 | null; locked: LockReason | null } | null): boolean {
  return !!rs && rs.seat !== null && !(rs.locked && HARD_LOCKS.has(rs.locked));
}

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

/**
 * What the Start pill would start: the code, the opponent (mode and level) and the stored game it
 * resumes or reviews. Start compares it before and after waiting for the engine.
 */
function startSelection(code: string, opponent: Opponent, saved: SavedGame | null): string {
  const target = saved ? opponentOf(saved) : opponent;
  return [code, target.mode, target.mode === 'computer' ? target.level : '', saved?.id ?? ''].join('|');
}

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
  // In a room the same proposer goes to the controller: seat 0's engine proposes, seat 1's only
  // when seat 0 hands the proposal over (DESIGN 9.5). Unset without an engine.
  const roomOptions = useMemo(() => ({ propose: proposeDead }), [proposeDead]);
  const gs = useGameState({ proposeDead, rooms: PLAYABLE_MODES.room, room: roomOptions });
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
  /** The open room (room mode), and its controller snapshot. */
  const room = gs.room;
  const rs = room?.state ?? null;
  const roomMode = !!room;
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
      // A room whose current game is over opens with its overlay, where the rematch is asked for
      // (DESIGN 8.5, 9.4). No tint: the game did not end in this session.
      const s = sessionRef.current;
      setOverlay(!!s && s.mode === 'room' && !!gsRef.current.room && ended);
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
  // In a room the controller times the turn (DESIGN 9.7): external mode with its stamps, which use
  // the same performance.now() clock. Its flag rule (own at zero, the opponent's 2 s past zero)
  // is the controller's too; `timeout` hands the flag to it.
  const clock = useClock(sessionGame, session?.tc ?? null, {
    active: phase !== 'start',
    key: sessionId,
    onFlag: timeout,
    initialTurnMs: banked.current.ms,
    external: roomMode ? (rs?.clock ?? NO_TURN) : null,
    ownColor: roomMode ? session?.color : undefined,
    pauseWhenHidden: !roomMode,
  });
  const clockRef = useRef(clock);
  clockRef.current = clock;
  const mode = session?.mode ?? 'local';

  /* ---- engine trouble: one calm toast with Try again (DESIGN 10.1) ---- */
  const engineFailed = useCallback(
    (source: string, error: unknown, retry?: () => void) => {
      console.error(`Zigo engine: ${source} failed:`, error instanceof Error ? `${error.name}: ${error.message}` : error);
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
    onFail: (err) => engineFailed('computer move', err, () => computerRetry.current()),
    elapsed: clock.elapsed,
    sessionKey: sessionId,
  });
  computerRetry.current = computer.retry;

  // A game warms the engine up, so hints, the guard and the proposal answer at once: against the
  // computer always, in pass-and-play and in a room once stage 1 is on the device (no download for
  // a hint or a proposal nobody asked for yet).
  const stage1Cached = engineOffline.stage1.status === 'ready';
  const warm =
    ENGINE_ON && !!sessionGame && !sessionGame.end && (mode === 'computer' || ((mode === 'local' || mode === 'room') && stage1Cached));
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
    onFail: (err) => engineFailed('hint', err),
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
  // ROOM with a room this device holds: the room's settings apply and show dimmed (DESIGN 4.1, 9.1).
  const roomSaved = gs.roomSaved;
  const roomClock = useMemo(() => (roomSaved ? parseTc(roomSaved.tc) : null), [roomSaved]);

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
  const engineStart = useEngineStart(engine, { onFail: (err) => engineFailed('engine start', err, () => void handleStartRef.current()) });
  const { cancel: cancelEngineStart, prepare: prepareEngine } = engineStart;
  useEffect(() => {
    if (!isStart) cancelEngineStart();
  }, [isStart, cancelEngineStart]);
  // A new selection while Start waits for the engine (another code, ROOM, another level) cancels
  // that Start: the tap was for the old selection.
  const selection = startSelection(gs.code, gs.opponent, gs.startPill.saved);
  useEffect(() => {
    cancelEngineStart();
  }, [selection, cancelEngineStart]);

  const handleStart = useCallback(async () => {
    const pill = gs.startPill;
    const target = pill.saved ? opponentOf(pill.saved) : gs.opponent;
    const tapped = startSelection(gs.code, gs.opponent, pill.saved);
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
      // The player went elsewhere meanwhile (a history card, a link), or changed the selection.
      if (phaseRef.current !== 'start') return;
      const now = gsRef.current;
      if (startSelection(now.code, now.opponent, now.startPill.saved) !== tapped) return;
    }
    if (!begin(gsRef.current.start)) {
      comingSoon();
      return;
    }
    if (pill.label === 'start') startTutorial();
  }, [gs.startPill, gs.opponent, gs.code, prepareEngine, begin, comingSoon, startTutorial]);
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
    // A room plays on in the same room: Rematch asks the opponent (DESIGN 8.5, 9.4). The overlay
    // stays, its button showing the pending state, until game n+1 starts or the answer is No.
    // When it cannot be asked (the opponent is away) the button is disabled with a note.
    const r = gsRef.current.room;
    if (r) {
      if (r.state?.canAsk.rematch) r.ask('rematch');
      return;
    }
    setOverlay(false);
    gs.newGame();
  }, [gs]);

  const handleResign = useCallback(() => {
    const s = sessionRef.current;
    if (!s) return;
    // In a room resignation is final: no undo toast (DESIGN 8.3).
    if (gsRef.current.room) {
      if (gsRef.current.resign()) setPassToast(null);
      return;
    }
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
    // In a room a pass is taken back by a takeback request, not by the toast (DESIGN 9.4).
    if (s.mode === 'room') return;
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
    if (s?.mode === 'room') return void shareLink(url, 'room');
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

  /* ---- rooms: invite sheet and manual connection (DESIGN 9) ---- */
  const [inviteOpen, setInviteOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const roomCode = room?.code ?? null;
  const roomLive = !!rs?.live;
  // A new room (or none) starts with both sheets closed.
  const invited = useRef<string | null>(null);
  useEffect(() => {
    setInviteOpen(false);
    setManualOpen(false);
    if (!roomCode) invited.current = null;
  }, [roomCode]);
  // The creator's room shows the invite sheet by itself while nobody has joined (DESIGN 9), once;
  // after the first-game tutorial, so the two overlays do not stack.
  const offerInvite = shouldOfferInvite(rs) && room?.tab === 'owner' && !showTutorial;
  useEffect(() => {
    if (!offerInvite || !roomCode || invited.current === roomCode) return;
    invited.current = roomCode;
    setInviteOpen(true);
  }, [offerInvite, roomCode]);
  // The opponent is here: the sheets have done their job.
  useEffect(() => {
    if (!roomLive) return;
    setInviteOpen(false);
    setManualOpen(false);
  }, [roomLive]);

  /** `Connect manually` (invite sheet, failure toast): this device sends the offer (DESIGN 9). */
  const connectManually = useCallback(() => {
    const r = gsRef.current.room;
    if (!r) return;
    r.openManual();
    setInviteOpen(false);
    setManualOpen(true);
  }, []);
  const manual = room?.manual;
  const manualStep = manual?.step ?? 'idle';
  // This device answers an offer link (`x`) and the exchange is still running.
  const manualGuestActive = manual?.role === 'guest' && manualStep !== 'idle' && manualStep !== 'connected';
  // An offer link (`x`) or an answer link (`y`) opened here shows its step without a tap.
  const manualAuto = manualGuestActive || manualStep === 'handover';
  // The sheets are modal: they step aside once the manual channel is open and while a request
  // waits for an answer, so its toast (e.g. Allow for a rejoin) can be reached.
  const requestWaiting = !!rs?.requests.incoming;
  const manualShown = !!room && (manualOpen || manualAuto) && !roomLive && manualStep !== 'connected' && !requestWaiting;
  const inviteShown = inviteOpen && !manualShown && !requestWaiting;
  // The failure toast (with its own `Connect manually`) steps aside while a sheet that shows the
  // cause or the step is open, and never shows to the guest of a manual exchange (an `x` link).
  const failureQuiet = inviteShown || manualShown || manualGuestActive;
  // Done once its channel is open: a later loss starts from `Connect manually` again, not this sheet.
  useEffect(() => {
    if (manualStep === 'connected') setManualOpen(false);
  }, [manualStep]);
  const onManualOpenChange = useCallback((open: boolean) => {
    if (open) return;
    setManualOpen(false);
    gsRef.current.room?.closeManual();
  }, []);

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
  const roomScoring = room?.scoring ?? null;
  // In a room: this seat's Accept with its pending state, the opponent's acceptance, the proposal
  // under way and `Scoring continues when your opponent is back` (DESIGN 9.3, 9.5). The bar takes
  // the toolbar's place, so it carries the takeback request too, with its pending state (DESIGN
  // 9.4: takeback also works during scoring).
  const takebackPending = roomMode && rs?.requests.outgoing === 'takeback';
  const scoringBar = roomMode ? (
    scoringNow && roomScoring ? (
      <RoomScoringBar
        scoring={roomScoring}
        onAccept={() => void gsRef.current.room?.accept()}
        onResume={() => void gsRef.current.room?.resume()}
        takeback={{ onClick: () => void gsRef.current.undo(), pending: takebackPending, disabled: !gs.canUndo }}
        visible={chromeVisible}
        landscape={landscape}
      />
    ) : undefined
  ) : scoringNow ? (
    // While the engine's dead-stone proposal runs (DESIGN 8.4 steps 1 and 5), Accept would end the
    // game with every stone alive: both buttons wait, with `Finding dead stones…` or `Counting…`.
    <ScoringBar
      onResume={() => void gsRef.current.scoring.resume()}
      onAccept={() => acceptFor(faceToFace ? near : undefined)}
      accepted={faceToFace ? sc.acceptedBy[near] : false}
      side={faceToFace ? near : undefined}
      disabled={!sc.editable || sc.pending}
      note={sc.pending ? t(sc.round === 2 ? 'game.scoring.counting' : 'game.scoring.proposing') : undefined}
      visible={chromeVisible}
      landscape={landscape}
    />
  ) : undefined;
  const farAccept =
    scoringNow && faceToFace ? (
      <ScoringAccept variant="compact" side={far} accepted={sc.acceptedBy[far]} onAccept={() => acceptFor(far)} disabled={sc.pending} />
    ) : undefined;

  // A timed room while disconnected: both strips say `Paused` (DESIGN 9.7).
  const pausedNote =
    roomMode && !!rs?.clock.paused && !!session?.tc && !view?.end && !view?.scoring && phase === 'playing' ? t('room.paused') : undefined;
  // The opponent's strip dims while they are disconnected (DESIGN 9).
  const opponentAway = roomMode && rs?.presence !== 'connected';
  const strip = (color: Color, rotated: boolean, layout: 'row' | 'rail') =>
    session && view ? (
      <PlayerStrip
        color={color}
        prisoners={view.prisoners[color]}
        komi2={view.settings.komi2}
        passed={passed[color]}
        clock={pausedNote ? { ...faces[color], note: pausedNote } : faces[color]}
        active={!view.end && view.turn === color && !(opponentAway && color !== session.color)}
        score={sc.active && sc.score ? sc.score : undefined}
        action={color === far ? farAccept : undefined}
        rotated={rotated}
        details={showUI}
        layout={layout}
      />
    ) : null;

  // The room score from this device's point of view (DESIGN 9.4); a room game reviewed from
  // history reads it from the stored room record.
  const reviewedRoom = !room && session?.mode === 'room' ? saved.rooms.find((r) => r.code === session.code) : undefined;
  const roomScore: readonly [number, number] = room
    ? room.score
    : reviewedRoom
      ? [reviewedRoom.score[reviewedRoom.seat] / 2, reviewedRoom.score[reviewedRoom.seat === 0 ? 1 : 0] / 2]
      : NO_SCORE;
  const infoOpponent: InfoOpponent =
    mode === 'computer' ? { kind: 'computer', level: session?.level ?? 5 } : mode === 'room' ? { kind: 'room', score: roomScore } : { kind: 'local' };
  const info =
    session && view ? (
      <InfoPill
        code={session.code}
        presence={room ? <PresenceDot presence={rs?.presence ?? 'connecting'} onClick={() => setInviteOpen(true)} /> : undefined}
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
        // In the rail a little tighter, so strips, pill and score fit a 375 px high phone.
        className={landscape ? 'gap-2 py-2.5' : undefined}
      />
    ) : null;

  const end = session?.game.end;
  const tint = end && endedHere && session ? tintFor(end.result, session.mode, session.color) : null;
  const flagLive = phase === 'playing' && live && gs.isPlayerTurn;
  // In a room the flag works whenever this device may resign (also on the opponent's turn and
  // offline, DESIGN 8.3, 9.3); its tap passes on this device's turn only.
  const roomFlagLive = roomMode && phase === 'playing' && live && room?.tab === 'owner' && roomResignable(rs);
  // A room whose current game is over: Rematch lives on the overlay, and the toolbar's flag slot
  // brings the overlay back after it was dismissed, pulsing while this device's request waits.
  const roomOver = roomMode && !!end && phase === 'playing';
  const rematchPending = roomMode && rs?.requests.outgoing === 'rematch';
  const rematchBlocked = roomMode && !rematchPending && !rs?.canAsk.rematch;

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
  const langShown = isStart && !scrolled;

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
          data-room-phase={rs?.phase}
          data-room-presence={rs?.presence}
          data-room-failure={rs?.failureKind ?? undefined}
          data-room-cause={room?.manualCause ?? undefined}
          data-room-tab={room?.tab}
          data-room-via={room?.via ?? undefined}
          data-room-seat={rs?.seat ?? undefined}
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
              {/* Above the board's frame, so the far Accept's 44 px hit area reaches into the 4 px gap and frame padding. */}
              {!isStart && !landscape && <div className="absolute inset-x-0 bottom-full z-10 mb-1 px-1">{strip(far, faceToFace, 'row')}</div>}
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
              {/* The opponent's toggles flash once on this board (DESIGN 9.5). */}
              {roomMode && !isStart && view && <ToggleFlash size={view.settings.size} toggle={room?.lastToggle ?? null} />}
              {!isStart && !landscape && <div className="absolute inset-x-0 top-full mt-1 px-1">{strip(near, false, 'row')}</div>}
            </div>
          </BoardPreview>
        </main>

        {/* ---- game chrome ---- */}
        {session && (
          <>
            {landscape ? (
              <div
                // Left rail (DESIGN 4): centered in the height below the Back button. The auto
                // margins center it safely: content taller than the rail runs out at the bottom,
                // never up under the Back button (`justify-center` would split the overflow).
                className={cn(
                  'pointer-events-none fixed z-chrome left-[max(1rem,env(safe-area-inset-left))]',
                  'top-[calc(max(1.5rem,env(safe-area-inset-top))+3.25rem)] bottom-[max(1rem,env(safe-area-inset-bottom))]',
                  'flex flex-col items-center gap-2 [&>*]:pointer-events-auto [&>:first-child]:mt-auto [&>:last-child]:mb-auto',
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
              undoPending={takebackPending}
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
              flagDisabled={roomMode ? !roomFlagLive : !flagLive}
              onContinue={phase === 'review' ? handleContinue : undefined}
              onRematch={roomOver ? () => setOverlay(true) : undefined}
              rematchPending={rematchPending}
              onShare={roomMode && phase !== 'review' ? () => setInviteOpen(true) : handleShare}
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
            primaryBusy={rematchPending}
            primaryDisabled={rematchBlocked}
            primaryNote={
              rematchPending ? t('room.pending.waiting') : rematchBlocked && rs?.presence !== 'connected' ? t('room.presence.waiting') : undefined
            }
            onDismiss={() => setOverlay(false)}
          />
        )}

        {room && (
          <>
            <RoomToasts
              room={room.code}
              onNotice={room.onNotice}
              requests={rs?.requests}
              onReply={room.reply}
              manualCause={room.manualCause}
              live={roomLive}
              quiet={failureQuiet}
              onConnectManually={connectManually}
              onUpdateCheck={() => void checkForUpdate()}
            />
            <InviteSheet
              open={inviteShown}
              onOpenChange={setInviteOpen}
              code={room.code}
              presence={rs?.presence ?? null}
              manualCause={room.manualCause}
              onConnectManually={connectManually}
            />
            {manual && (
              <ManualConnectSheet
                open={manualShown}
                onOpenChange={onManualOpenChange}
                manual={manual}
                onAcceptAnswer={room.acceptAnswer}
                onStartOver={room.restartManual}
              />
            )}
            <RoomBanner tab={room.tab} phase={rs?.phase} waiting={waitsAsAnchor(rs)} onTakeOver={room.takeOver} />
          </>
        )}

        {session && !roomMode && (
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
            // Open while that pass can still be taken back: in pass-and-play while it is the last
            // ply, against the computer also after the computer's reply (DESIGN 6.2).
            open={!resigned && undoPassIndex(session) === passToast.cursor - 1}
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
          color={roomSaved ? roomSaved.color : gs.colorChoice}
          onColorChange={gs.setColorChoice}
          size={roomSaved ? roomSaved.size : gs.size}
          onSizeChange={gs.setSize}
          rules={roomSaved ? roomSaved.rules : gs.rules}
          onRulesChange={gs.setRules}
          handicap={roomSaved ? roomSaved.handicap : gs.handicap}
          onHandicapChange={gs.setHandicap}
          clock={roomSaved ? roomClock : startClock}
          onClockChange={(tc) => gs.setTc(formatTc(tc))}
          saved={pillSaved}
          pillsLocked={!!roomSaved}
          busy={animating}
          showChevron={saved.games.length > 0}
          engineStatus={<EngineStatus line={engineOffline.line} onDownload={engineOffline.download} />}
          footerExtra={canInstall ? <InstallButton onClick={() => void install()} /> : undefined}
          onVersionTap={() => void checkForUpdate()}
        />

        {/* Hidden (in a game, or the start screen scrolled): out of the Tab order too, as the version stamp. */}
        <div
          className={cn(
            'fixed z-chrome top-[max(1.5rem,env(safe-area-inset-top))] right-[max(1rem,env(safe-area-inset-right))]',
            'transition-all duration-500 ease-out',
            langShown ? 'scale-100 opacity-100' : 'pointer-events-none scale-90 opacity-0',
          )}
          aria-hidden={langShown ? undefined : true}
        >
          <LanguageSwitcher tabIndex={langShown ? undefined : -1} />
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
