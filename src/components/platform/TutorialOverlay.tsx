/**
 * Coach-mark tutorial (DESIGN 14.2, Ztyle 15): one overlay of floating bubbles placed next to
 * the things they explain, over the live game. Dismissed by tapping or clicking anywhere (or
 * any key). Bubbles enter staggered by 100 ms and fade out together in 400 ms.
 *
 * Content (DESIGN 14.2 plus the Ztyle template): back + saved, the game code, how to place a
 * stone (tap; on 13×13 and 19×19 tap the ghost stone again; type `D4` on pointer devices), the
 * scoring step (after two passes, tap dead groups and Accept), the toolbar (shield, bulb
 * tap/hold, flag tap pass / hold resign), tap the background to hide the UI. Against the computer
 * the toolbar bubble also says that levels 10–12 play stronger on faster devices (DESIGN 10.2).
 * Portrait: 3 rows;
 * mobile landscape: 3 columns. Touch devices get the gesture texts, pointer devices click/type.
 *
 * Ported from Zudoku `TutorialOverlay.tsx`; fixes: dismiss runs once (Zudoku fired on both
 * touchstart and click), keyboard dismiss, dialog semantics, no hard-coded strings.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, EyeOff, Flag, Lightbulb, ShieldCheck } from 'lucide-react';
import { useIsTouchDevice } from '@/hooks/use-mobile';
import { useIsMobileLandscape } from '@/hooks/use-orientation';
import { useI18n } from '@/lib/i18n';
import type { Mode, Size } from '@/lib/types';
import { cn } from '@/lib/utils';
import { StoneGlyph } from '@/components/board';

export const TUTORIAL_EXIT_MS = 400;
const STAGGER_MS = 100;

export interface TutorialOverlayProps {
  /** Called once, after the fade-out. Pair with `useTutorial().completeTutorial`. */
  onDismiss: () => void;
  /** Toolbar contents follow the mode (DESIGN 4.2): no bulb in rooms. */
  mode?: Mode;
  /**
   * Board size of the game: 9×9 places on the first tap, 13×13 and 19×19 confirm on the ghost
   * stone (DESIGN 6.1). Omitted: both are explained.
   */
  size?: Size;
  /** Mobile landscape layout; detected when omitted. */
  isLandscape?: boolean;
  /** Touch texts; detected when omitted. */
  isTouch?: boolean;
}

function Bubble({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(id);
  }, [delay]);
  return (
    <div
      className={cn(
        'bg-card/95 backdrop-blur-sm rounded-xl px-4 py-3 shadow-xl border border-border text-sm max-w-[200px]',
        'transition-all duration-500 ease-out motion-reduce:transition-none',
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Icon + short text row inside the toolbar bubble. */
function Row({ icon, text, small }: { icon: ReactNode; text: string; small?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-primary shrink-0 [&>svg]:w-3 [&>svg]:h-3" aria-hidden="true">
        {icon}
      </span>
      <span className={small ? 'text-[10px]' : 'text-xs'}>{text}</span>
    </div>
  );
}

/** Grid positions (px) of a 3 × 3 board corner in the 54 px illustrations. */
const GRID = [9, 27, 45];

/** A stone glyph centered on intersection (col, row) of the mini grid. */
function MiniStone({ col, row, color, className }: { col: number; row: number; color: 'B' | 'W'; className?: string }) {
  return (
    <span
      className={cn('absolute w-4 h-4 -translate-x-1/2 -translate-y-1/2 flex', className)}
      style={{ left: GRID[col], top: GRID[row] }}
    >
      <StoneGlyph color={color} className="w-4 h-4" />
    </span>
  );
}

/** Three lines each way: the corner of a board in thin foreground strokes. */
function MiniGrid({ children, crosshair }: { children?: ReactNode; crosshair?: { col: number; row: number } }) {
  return (
    <div className="relative mx-auto my-2 w-[54px] h-[54px]" aria-hidden="true">
      <svg viewBox="0 0 54 54" className="absolute inset-0 w-full h-full overflow-visible">
        <g className="stroke-foreground/40" strokeWidth={1} fill="none">
          {GRID.map((v) => (
            <path key={`h${v}`} d={`M${GRID[0]} ${v}H54`} />
          ))}
          {GRID.map((v) => (
            <path key={`v${v}`} d={`M${v} ${GRID[0]}V54`} />
          ))}
        </g>
        {crosshair && (
          <g className="stroke-foreground/30" strokeWidth={1} strokeDasharray="2 2">
            <path d={`M0 ${GRID[crosshair.row]}H54`} />
            <path d={`M${GRID[crosshair.col]} 0V54`} />
          </g>
        )}
      </svg>
      {children}
    </div>
  );
}

/** Touch: a placed white stone and the black ghost stone with its crosshairs. */
function MoveIllustration() {
  return (
    <MiniGrid crosshair={{ col: 2, row: 1 }}>
      <MiniStone col={1} row={1} color="W" />
      <MiniStone col={2} row={1} color="B" className="opacity-45" />
    </MiniGrid>
  );
}

/** Keycaps for typing a point (pointer devices). */
function KeysIllustration() {
  return (
    <div className="flex justify-center gap-1 mt-2" aria-hidden="true">
      {['D4', '↵'].map((k) => (
        <kbd key={k} className="px-1.5 h-6 min-w-6 rounded border border-border bg-muted flex items-center justify-center font-mono text-xs">
          {k}
        </kbd>
      ))}
    </div>
  );
}

/** Scoring: a dead white stone (faded, ×) inside black territory (small squares). */
function ScoringIllustration() {
  return (
    <MiniGrid>
      <MiniStone col={0} row={2} color="B" />
      <MiniStone col={1} row={2} color="B" />
      <MiniStone col={2} row={1} color="B" />
      <MiniStone col={1} row={1} color="W" className="opacity-40" />
      <svg viewBox="0 0 54 54" className="absolute inset-0 w-full h-full overflow-visible">
        <path d="M24 24l6 6M30 24l-6 6" className="stroke-foreground" strokeWidth={1.25} strokeLinecap="round" />
        {[
          [0, 0],
          [1, 0],
          [0, 1],
        ].map(([c, r]) => (
          <rect key={`${c}${r}`} x={GRID[c] - 2.5} y={GRID[r] - 2.5} width={5} height={5} fill="hsl(var(--ink-dark))" stroke="hsl(var(--foreground))" strokeWidth={0.5} />
        ))}
      </svg>
    </MiniGrid>
  );
}

export function TutorialOverlay({ onDismiss, mode = 'computer', size, isLandscape, isTouch }: TutorialOverlayProps) {
  const { t } = useI18n();
  const detectedLandscape = useIsMobileLandscape();
  const detectedTouch = useIsTouchDevice();
  const landscape = isLandscape ?? detectedLandscape;
  const touch = isTouch ?? detectedTouch;

  const [exiting, setExiting] = useState(false);
  const done = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const dismiss = useCallback(() => {
    if (done.current) return;
    done.current = true;
    setExiting(true);
    setTimeout(() => onDismissRef.current(), TUTORIAL_EXIT_MS);
  }, []);

  useEffect(() => {
    root.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      dismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismiss]);

  const showHint = mode !== 'room';

  const back = (
    <div className="flex items-start gap-2">
      <ArrowLeft className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" aria-hidden="true" />
      <div>
        <span className="font-medium text-xs">{t('platform.tutorial.backTitle')}</span>
        <p className="text-muted-foreground text-[10px] mt-0.5">{t('platform.tutorial.backBody')}</p>
      </div>
    </div>
  );
  const code = (
    <div>
      <span className="font-medium text-xs">{t('platform.tutorial.codeTitle')}</span>
      <p className="text-muted-foreground text-[10px] mt-0.5">{t('platform.tutorial.codeBody')}</p>
    </div>
  );
  const touchText =
    size === 9 ? (
      t('platform.tutorial.moveTouch')
    ) : size ? (
      t('platform.tutorial.moveTouchGhost')
    ) : (
      <>
        {t('platform.tutorial.moveTouch')} {t('platform.tutorial.moveTouchLarge')}
      </>
    );
  const move = (
    <div className="text-center">
      <span className="font-medium text-sm">{t('platform.tutorial.moveTitle')}</span>
      <p className="text-muted-foreground text-xs mt-1">{touch ? touchText : t('platform.tutorial.movePointer')}</p>
      {touch ? <MoveIllustration /> : <KeysIllustration />}
    </div>
  );
  const scoring = (
    <div className="text-center">
      <span className="font-medium text-xs">{t('platform.tutorial.scoringTitle')}</span>
      <p className="text-muted-foreground text-[10px] mt-1">{t('platform.tutorial.scoringBody')}</p>
      <ScoringIllustration />
    </div>
  );
  const toolbar = (
    <div className="space-y-1.5">
      <Row icon={<ShieldCheck />} text={t('platform.tutorial.helpers')} small={landscape} />
      {showHint && <Row icon={<Lightbulb />} text={t('platform.tutorial.hint')} small={landscape} />}
      <Row icon={<Flag />} text={t('platform.tutorial.flag')} small={landscape} />
      {mode === 'computer' && (
        <p className="text-muted-foreground text-[10px] pt-0.5" data-testid="tutorial-levels">
          {t('platform.tutorial.levels')}
        </p>
      )}
    </div>
  );
  const hide = (
    <div className="flex items-center gap-2">
      <EyeOff className="w-3 h-3 text-primary shrink-0" aria-hidden="true" />
      <p className="text-muted-foreground text-[10px]">{t('platform.tutorial.hideUi')}</p>
    </div>
  );

  const overlay = (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={t('platform.tutorial.label')}
      tabIndex={-1}
      data-testid="tutorial-overlay"
      className={cn(
        'fixed inset-0 z-[100] outline-none select-none cursor-pointer transition-opacity [transition-duration:400ms]',
        exiting ? 'opacity-0' : 'opacity-100',
      )}
      onClick={dismiss}
    >
      <div className="absolute inset-0 bg-background/60 backdrop-blur-[2px]" />

      {!landscape ? (
        <div className="absolute inset-0 flex flex-col">
          <div className="flex justify-between items-start gap-3 px-4 pt-[max(5rem,calc(env(safe-area-inset-top)+4rem))]">
            <Bubble delay={STAGGER_MS}>{back}</Bubble>
            <Bubble delay={2 * STAGGER_MS}>{code}</Bubble>
          </div>
          <div className="flex-1 flex items-center justify-center px-4 gap-3">
            <Bubble delay={3 * STAGGER_MS} className="max-w-[180px]">
              {move}
            </Bubble>
            <Bubble delay={4 * STAGGER_MS} className="max-w-[140px]">
              {scoring}
            </Bubble>
          </div>
          <div className="flex justify-between items-end gap-3 px-4 pb-[max(5rem,calc(env(safe-area-inset-bottom)+4rem))]">
            <Bubble delay={5 * STAGGER_MS}>{hide}</Bubble>
            <Bubble delay={6 * STAGGER_MS}>{toolbar}</Bubble>
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 flex">
          <div className="flex flex-col justify-between py-4 pl-[max(1rem,env(safe-area-inset-left))] w-1/4">
            <Bubble delay={STAGGER_MS}>{back}</Bubble>
            <Bubble delay={2 * STAGGER_MS}>{code}</Bubble>
          </div>
          <div className="flex-1 flex items-center justify-center gap-4">
            <Bubble delay={3 * STAGGER_MS} className="max-w-[180px]">
              {move}
            </Bubble>
            <Bubble delay={4 * STAGGER_MS} className="max-w-[140px]">
              {scoring}
            </Bubble>
          </div>
          <div className="flex flex-col justify-between items-end py-4 pr-[max(1rem,env(safe-area-inset-right))] w-1/4">
            <Bubble delay={5 * STAGGER_MS} className="max-w-[160px]">
              {toolbar}
            </Bubble>
            <Bubble delay={6 * STAGGER_MS} className="max-w-[160px]">
              {hide}
            </Bubble>
          </div>
        </div>
      )}

      <div className="absolute bottom-[max(0.5rem,env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2">
        <p className="text-muted-foreground/60 text-[10px] whitespace-nowrap animate-pulse motion-reduce:animate-none">
          {t('platform.tutorial.tapToStart')}
        </p>
      </div>
    </div>
  );

  return typeof document === 'undefined' ? overlay : createPortal(overlay, document.body);
}
