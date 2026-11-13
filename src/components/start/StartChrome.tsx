/**
 * Every fixed piece of the start screen in one component (DESIGN 4, 4.1). It overlays the stage
 * and never moves the board: the integrator renders the board inside `BoardPreview` (with the
 * `StartPill` as its overlay) and this component next to it.
 *
 *   StartHeader   wordmark, tagline, CodeSelector          (idle start screen)
 *   StartFooter   OpponentSelector (with the rank slot),   (idle start screen)
 *                 ColorPill, SizePill, ClockPill,
 *                 engineStatus, footerExtra, ScrollChevron
 *   StickyHeader  small wordmark bar                        (scrolled past 50 px)
 *   BackToTop     FAB                                       (scrolled past 50 px)
 *   VersionStamp                                            (start screen)
 *   Dials         HandicapDial (hold the color pill), RulesDial (hold the size pill),
 *                 ClockDial (hold the clock pill); open only on the idle start screen
 *
 * A code that refers to a saved game (`saved`) shows that game's opponent, color, size, rules,
 * handicap and clock, dimmed and locked (DESIGN 4.1). With `ROOM` selected and a room this device
 * already holds, the room's settings apply (DESIGN 9.1): the integrator passes them as the values
 * with `pillsLocked`, which dims the pills but leaves the opponent selector free.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { flags } from '@/lib/flags';
import type { ColorChoice, Opponent, Rng, Rules, SavedGame, Size, TimeControl } from '@/lib/types';
import { parseTc } from '@/lib/zigo';
import { BackToTop } from './BackToTop';
import { ClockDial } from './ClockDial';
import { ClockPill } from './ClockPill';
import { CodeSelector, type CodeSource } from './CodeSelector';
import { ColorPill } from './ColorPill';
import { HandicapDial } from './HandicapDial';
import { OpponentSelector } from './OpponentSelector';
import { settingsOfGame } from './options';
import { RulesDial } from './RulesDial';
import { ScrollChevron } from './ScrollChevron';
import { SizePill } from './SizePill';
import { StartFooter } from './StartFooter';
import type { PillAnchor } from './useHold';
import { VersionStamp } from './VersionStamp';
import { StartHeader, StickyHeader } from './Wordmark';

export interface StartChromeProps {
  /** The start screen is showing (also during the game → start transition). */
  visible: boolean;
  /** From `useScrolled()`: swaps the big header for the sticky one and shows back-to-top. */
  scrolled?: boolean;
  /** Mobile landscape layout (`innerWidth > innerHeight && min side < 768`). */
  landscape?: boolean;

  code: string;
  onCodeChange: (code: string, source: CodeSource) => void;
  /** Random source for new codes (tests). */
  rng?: Rng;

  opponent: Opponent;
  onOpponentChange: (value: Opponent) => void;
  /** Calibrated rank of the selected computer level (`≈12k`); absent until calibrated. */
  opponentRank?: string | null;
  color: ColorChoice;
  onColorChange: (value: ColorChoice) => void;
  size: Size;
  onSizeChange: (value: Size) => void;
  rules: Rules;
  onRulesChange: (value: Rules) => void;
  /** Handicap of the selected size (0 or 2 … 9). */
  handicap: number;
  onHandicapChange: (value: number) => void;
  /** Clock of the selected size. */
  clock: TimeControl;
  onClockChange: (value: TimeControl) => void;

  /** The saved game the code refers to (RESUME / REVIEW): its settings are shown dimmed and locked. */
  saved?: SavedGame | null;
  /** Locks every selector without a saved game to show (the values passed are shown dimmed). */
  settingsLocked?: boolean;
  /** Room joiner: the color pill (and its handicap) is dimmed because the creator's choice applies. */
  colorLocked?: boolean;
  /** A room's own settings apply: the color, size and clock pills are dimmed and locked; the opponent selector stays free. */
  pillsLocked?: boolean;
  /** Blocks the code field during the start transition. */
  busy?: boolean;

  /** Show the bounce chevron (e.g. only when there is history below). Default true. */
  showChevron?: boolean;
  /** The computer's offline state (`EngineStatus`), under the pills. */
  engineStatus?: ReactNode;
  /** Extra footer content, e.g. the install pill. */
  footerExtra?: ReactNode;
  /** Called when the version stamp is tapped (after copying), e.g. the SW update check. */
  onVersionTap?: () => void;
}

type OpenDial = { kind: 'handicap' | 'rules' | 'clock'; x: number; y: number; dragging: boolean };

export function StartChrome({
  visible,
  scrolled = false,
  landscape = false,
  code,
  onCodeChange,
  rng,
  opponent,
  onOpponentChange,
  opponentRank,
  color,
  onColorChange,
  size,
  onSizeChange,
  rules,
  onRulesChange,
  handicap,
  onHandicapChange,
  clock,
  onClockChange,
  saved,
  settingsLocked = false,
  colorLocked = false,
  pillsLocked = false,
  busy = false,
  showChevron = true,
  engineStatus,
  footerExtra,
  onVersionTap,
}: StartChromeProps) {
  const idle = visible && !scrolled;
  const locked = settingsLocked || !!saved;
  const pillsOff = locked || pillsLocked;
  const shown = saved
    ? settingsOfGame(saved)
    : { opponent, color, size, rules, handicap, clock };
  // Pass-and-play has no "your color": both sides sit at this device. The handicap still applies.
  const colorFixed = shown.opponent.mode === 'local';

  const [dial, setDial] = useState<OpenDial | null>(null);
  const open = (kind: OpenDial['kind']) => (a: PillAnchor) => setDial({ kind, x: a.x, y: a.y, dragging: a.source === 'pointer' });
  const close = () => setDial(null);
  useEffect(() => {
    if (!idle || pillsOff) setDial(null);
  }, [idle, pillsOff]);

  return (
    <>
      <StickyHeader visible={visible && scrolled} />
      <BackToTop visible={visible && scrolled} />

      <StartHeader visible={idle} landscape={landscape}>
        <CodeSelector code={code} onChange={onCodeChange} rng={rng} disabled={!idle || busy} landscape={landscape} />
      </StartHeader>

      <StartFooter
        visible={idle}
        landscape={landscape}
        selector={
          <OpponentSelector
            value={shown.opponent}
            onChange={onOpponentChange}
            disabled={locked}
            landscape={landscape}
            rank={locked ? null : opponentRank}
          />
        }
        pills={
          <>
            <ColorPill
              value={shown.color}
              onChange={onColorChange}
              handicap={shown.handicap}
              onLongPress={open('handicap')}
              disabled={pillsOff || colorLocked}
              colorFixed={colorFixed}
            />
            <SizePill size={shown.size} rules={shown.rules} onChange={onSizeChange} onLongPress={open('rules')} disabled={pillsOff} />
            {flags.clock && (
              <ClockPill
                size={shown.size}
                value={shown.clock}
                onChange={onClockChange}
                onLongPress={open('clock')}
                disabled={pillsOff}
              />
            )}
          </>
        }
        status={engineStatus}
        extra={footerExtra}
        chevron={showChevron ? <ScrollChevron hidden={!idle} /> : undefined}
      />

      <VersionStamp visible={visible} onTap={onVersionTap} />

      {dial?.kind === 'handicap' && (
        <HandicapDial
          x={dial.x}
          y={dial.y}
          dragging={dial.dragging}
          size={size}
          value={handicap}
          onPick={(n) => {
            close();
            onHandicapChange(n);
          }}
          onCancel={close}
        />
      )}
      {dial?.kind === 'rules' && (
        <RulesDial
          x={dial.x}
          y={dial.y}
          dragging={dial.dragging}
          value={rules}
          onPick={(r) => {
            close();
            onRulesChange(r);
          }}
          onCancel={close}
        />
      )}
      {dial?.kind === 'clock' && (
        <ClockDial
          x={dial.x}
          y={dial.y}
          dragging={dial.dragging}
          value={clock}
          onPick={(tc) => {
            close();
            onClockChange(parseTc(tc));
          }}
          onCancel={close}
        />
      )}
    </>
  );
}
