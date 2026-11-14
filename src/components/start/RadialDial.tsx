/**
 * The Ztyle radial dial (chapter 08) of the start screen, shared by the clock, handicap and rules
 * dials (DESIGN 4.1, 6.3). It shows one step at a time; the owner of the dial decides what the
 * next step is. 40 px items on a 60 px radius from 12 o'clock clockwise (turned by the step's
 * `rotation`), centre `×`, aim zone 40–55 px (accent, scale 1.6), commit zone ≥ 55 px (pops out to
 * 105 px and inverts), rubber band from the start point, portaled to `body`, clamped inside the
 * viewport. The current value carries the "noted" ring.
 *
 * Gestures:
 * - Still holding after the pill's hold: drag and release on an item (aim or commit zone) picks it.
 *   Releasing where the hold started keeps the dial open for taps.
 * - Tap an item to pick it; press the centre and drag to aim again. Tap `×`, tap outside or press
 *   Escape to cancel.
 *
 * Keyboard: focus moves into the dial; arrows aim (clockwise / counter-clockwise), Home / End,
 * Enter or Space confirm, Backspace goes one step back (`onBack`), Escape cancels. Focus goes back
 * to where it was on close.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { DIAL_GEOMETRY, dialAim, dialItemOffset, type DialZone } from './dialGeometry';
import { CAPTION_GAP, captionSide, clampCenter } from './dialPlacement';

export interface DialItem {
  /** Written to `data-value`; unique within the step. */
  readonly value: string;
  /** What the 40 px circle shows. */
  readonly text: ReactNode;
  /** Accessible name. */
  readonly label: string;
  /** Caption shown while the item is aimed (else the step's caption). */
  readonly caption?: ReactNode;
}

export interface DialStep {
  /** Written to `data-step`; a new id resets the aim. */
  readonly id: string;
  /** Accessible name of the menu. */
  readonly title: string;
  /** The caption pill under (or above) the ring. */
  readonly caption: ReactNode;
  readonly items: readonly DialItem[];
  /** Index of the current value (the "noted" ring). */
  readonly noted?: number | null;
  /** First keyboard aim and Enter-without-aim pick, e.g. the item nearest the current value; default `noted`, else 0. */
  readonly start?: number | null;
  /** Index aimed when the step opens (e.g. after Backspace). */
  readonly aim?: number | null;
  /** Turns the ring, in turns (−¼: item 0 at 9 o'clock). */
  readonly rotation?: number;
}

export interface RadialDialProps {
  /** Where the hold happened, in viewport coordinates. */
  readonly x: number;
  readonly y: number;
  /** The pointer that held the pill is still down: drag-to-aim is live from the start. */
  readonly dragging?: boolean;
  readonly step: DialStep;
  /** An item of the current step was picked. */
  readonly onChoose: (index: number) => void;
  /** Backspace: one step back. */
  readonly onBack?: () => void;
  /** Closed without a choice. */
  readonly onCancel: () => void;
  /** Spoken hint for the keys (`aria-description`). */
  readonly keysHint: string;
  /** Accessible name of the centre `×`. */
  readonly cancelLabel: string;
  /** `data-testid` of the menu; the backdrop gets `<testId>-backdrop`. */
  readonly testId: string;
}

interface Drag {
  /** Start point of the gesture (offsets are measured from here). */
  readonly ox: number;
  readonly oy: number;
  /** Started by the pill's hold (a release without moving keeps the dial open). */
  readonly fromHold: boolean;
  /** The pointer has left the centre at some point. */
  moved: boolean;
}

type Aim = { zone: DialZone; index: number | null };
const CENTER: Aim = { zone: 'center', index: null };

export function RadialDial({ x, y, dragging = false, step, onChoose, onBack, onCancel, keysHint, cancelLabel, testId }: RadialDialProps) {
  const [aim, setAim] = useState<Aim>(() => (step.aim != null ? { zone: 'aim', index: step.aim } : CENTER));
  const [band, setBand] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 });
  const [center] = useState(() => clampCenter(x, y));
  const [caption] = useState(() => captionSide({ y }, center));
  const drag = useRef<Drag | null>(dragging ? { ox: x, oy: y, fromHold: true, moved: false } : null);
  const menu = useRef<HTMLDivElement>(null);

  const n = step.items.length;
  const rotation = step.rotation ?? 0;

  // A new step starts with its own aim.
  const shownStep = useRef(step.id);
  useLayoutEffect(() => {
    if (shownStep.current === step.id) return;
    shownStep.current = step.id;
    setAim(step.aim != null ? { zone: 'aim', index: step.aim } : CENTER);
  }, [step.id, step.aim]);

  // Latest values for the window listeners.
  const live = useRef({ n, rotation, onChoose, onCancel });
  live.current = { n, rotation, onChoose, onCancel };

  const choose = useCallback((index: number) => {
    drag.current = null;
    setBand({ dx: 0, dy: 0 });
    setAim(CENTER);
    live.current.onChoose(index);
  }, []);

  const cancel = useCallback(() => {
    drag.current = null;
    live.current.onCancel();
  }, []);

  /* ---- focus in on open, back out on close ---- */
  useLayoutEffect(() => {
    const before = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    menu.current?.focus({ preventScroll: true });
    return () => {
      if (before && typeof before.focus === 'function' && before.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  /* ---- drag-to-aim on the window (the pill's pointer may be captured by the pill) ---- */
  useEffect(() => {
    const aimAt = (e: globalThis.PointerEvent | MouseEvent, d: Drag) =>
      dialAim(e.clientX - d.ox, e.clientY - d.oy, live.current.n, live.current.rotation);
    const move = (e: globalThis.PointerEvent | MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      const a = aimAt(e, d);
      if (a.zone !== 'center') d.moved = true;
      setAim(a);
      setBand({ dx: e.clientX - d.ox, dy: e.clientY - d.oy });
    };
    const up = (e: globalThis.PointerEvent | MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      const a = aimAt(e, d);
      if (a.index !== null && (a.zone === 'aim' || a.zone === 'commit')) {
        choose(a.index);
        return;
      }
      drag.current = null;
      setBand({ dx: 0, dy: 0 });
      setAim(CENTER);
      // Back on the centre after leaving it, or a tap on `×`: cancel. A plain hold release keeps it open.
      if (a.zone === 'center' && (d.moved || !d.fromHold)) cancel();
    };
    const stop = () => {
      drag.current = null;
      setBand({ dx: 0, dy: 0 });
    };
    // While aiming on touch, the page must not scroll (a scroll would cancel the pointer).
    const noScroll = (e: TouchEvent) => {
      if (drag.current && e.cancelable) e.preventDefault();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', stop);
    window.addEventListener('touchmove', noScroll, { passive: false });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', stop);
      window.removeEventListener('touchmove', noScroll);
    };
  }, [choose, cancel]);

  /* ---- keyboard ---- */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const start = step.start ?? step.noted ?? 0;
    const at = aim.index;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = at === null ? start : (at + 1) % n;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = at === null ? start : (at - 1 + n) % n;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = n - 1;
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        e.stopPropagation();
        choose(at ?? start);
        return;
      case 'Backspace':
        e.preventDefault();
        onBack?.();
        return;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        cancel();
        return;
      case 'Tab':
        // Focus stays in the dial while it is open.
        e.preventDefault();
        return;
      default:
        return;
    }
    e.preventDefault();
    setAim({ zone: 'aim', index: next });
  };

  /* ---- pointer on the dial ---- */
  const onCenterDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { ox: e.clientX, oy: e.clientY, fromHold: false, moved: false };
    setAim(CENTER);
  };

  const onItemDown = (index: number) => (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    choose(index);
  };

  if (typeof document === 'undefined') return null;

  const { radius, popRadius } = DIAL_GEOMETRY;
  // The band is drawn from the gesture start; in the dial's frame that is the start minus the centre.
  const d = drag.current;
  const bx = d ? d.ox - center.x : 0;
  const by = d ? d.oy - center.y : 0;
  const aimedItem = aim.index !== null && aim.zone !== 'center' && aim.zone !== 'none' ? step.items[aim.index] : undefined;
  const captionText = aimedItem?.caption ?? step.caption;
  const idOf = (i: number) => `zengo-${testId}-${step.id}-${i}`;

  return createPortal(
    <>
      <div
        aria-hidden
        data-testid={`${testId}-backdrop`}
        className="fixed inset-0 z-overlay touch-none"
        onPointerDown={(e) => {
          e.preventDefault();
          if (!drag.current) cancel();
        }}
      />
      <div
        ref={menu}
        role="menu"
        aria-label={step.title}
        aria-description={keysHint}
        aria-activedescendant={aim.index !== null ? idOf(aim.index) : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-testid={testId}
        data-step={step.id}
        data-zengo-dial=""
        className="fixed z-overlay touch-none select-none outline-none animate-scale-in"
        style={{ left: center.x, top: center.y, width: 0, height: 0 }}
      >
        {(band.dx !== 0 || band.dy !== 0) && (
          <svg
            className="pointer-events-none absolute text-foreground"
            style={{ left: bx, top: by, overflow: 'visible' }}
            width="1"
            height="1"
            aria-hidden
          >
            <line x1="0" y1="0" x2={band.dx} y2={band.dy} stroke="currentColor" strokeWidth="2" strokeOpacity="0.3" strokeLinecap="round" />
          </svg>
        )}
        <span
          aria-hidden
          data-part="caption"
          data-side={caption}
          className="pointer-events-none absolute inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-foreground/10 bg-card/90 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground shadow-sm"
          style={
            caption === 'below'
              ? { left: 0, top: radius + CAPTION_GAP, transform: 'translateX(-50%)' }
              : { left: 0, top: -(radius + CAPTION_GAP), transform: 'translate(-50%, -100%)' }
          }
        >
          {captionText}
        </span>
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          aria-label={cancelLabel}
          data-part="cancel"
          onPointerDown={onCenterDown}
          onClick={(e) => {
            // Keyboard or assistive-technology activation only (detail 0); pointers use the drag path.
            if (e.detail === 0) cancel();
          }}
          className={cn('dial-item cursor-pointer font-mono', aim.zone === 'center' && drag.current && 'dial-item--commit')}
          style={{ left: -20, top: -20 }}
        >
          <span aria-hidden>×</span>
        </button>
        {step.items.map((item, i) => {
          const hovered = aim.index === i && aim.zone !== 'center' && aim.zone !== 'none';
          const commit = hovered && aim.zone === 'commit';
          const pos = dialItemOffset(i, n, commit ? popRadius : radius, rotation);
          const isNoted = step.noted === i;
          return (
            <button
              // A new key per step: the pointerdown that picked the previous step must not click this one.
              key={`${step.id}-${item.value}`}
              id={idOf(i)}
              type="button"
              role="menuitemradio"
              aria-checked={isNoted}
              tabIndex={-1}
              aria-label={item.label}
              data-value={item.value}
              data-aimed={hovered || undefined}
              onPointerDown={onItemDown(i)}
              onClick={(e) => {
                if (e.detail === 0) choose(i);
              }}
              className={cn(
                'dial-item cursor-pointer font-mono tabular-nums',
                isNoted && !hovered && 'dial-item--noted',
                hovered && !commit && 'dial-item--aim',
                commit && 'dial-item--commit',
              )}
              style={{
                left: pos.x - 20,
                top: pos.y - 20,
                transform: hovered ? 'scale(1.6)' : 'scale(1)',
                zIndex: hovered ? 1 : undefined,
              }}
            >
              {item.text}
            </button>
          );
        })}
      </div>
    </>,
    document.body,
  );
}
