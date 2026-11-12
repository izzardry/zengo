/** Start screen (package 1D). Presentational pieces plus the remembered-choice hooks. */
export { StartChrome, type StartChromeProps } from './StartChrome';
export { Wordmark, StartHeader, StickyHeader, type WordmarkProps, type StartHeaderProps, type StickyHeaderProps } from './Wordmark';
export { StartFooter, type StartFooterProps } from './StartFooter';
export { EngineStatus, type EngineStatusProps } from './EngineStatus';
export { CodeSelector, type CodeSelectorProps, type CodeSource } from './CodeSelector';
export { OpponentSelector, type OpponentSelectorProps } from './OpponentSelector';
export { ColorPill, ColorGlyph, type ColorPillProps } from './ColorPill';
export { SizePill, type SizePillProps } from './SizePill';
export { ClockPill, CLOCK_HOLD_MS, type ClockPillProps, type ClockPillAnchor } from './ClockPill';
export { StartPill, type StartPillProps } from './StartPill';
export { RadialDial, type RadialDialProps, type DialItem, type DialStep } from './RadialDial';
export {
  ClockDial,
  DIAL_MINUTES,
  DIAL_INCREMENTS,
  DIAL_PERIOD_SECONDS,
  DIAL_PERIODS,
  type ClockDialProps,
} from './ClockDial';
export { HandicapDial, type HandicapDialProps } from './HandicapDial';
export { RulesDial, type RulesDialProps } from './RulesDial';
export { BoardPreview, type BoardPreviewProps } from './BoardPreview';
export { PreviewBoard, type PreviewBoardProps } from './PreviewBoard';
export { previewGame, type PreviewSettings } from './preview';
export { ScrollChevron, type ScrollChevronProps } from './ScrollChevron';
export { BackToTop, type BackToTopProps } from './BackToTop';
export { VersionStamp, APP_VERSION, type VersionStampProps } from './VersionStamp';
export { useOpponentText, useColorName, useClockText, useHandicapText, useRulesName, copyText } from './text';
export { useScrolled, scrollOneViewport, scrollToTop, scrollBehavior, SCROLL_THRESHOLD } from './useScrolled';
export { useHold, HOLD_MS, type PillAnchor } from './useHold';
export {
  useStartPrefs,
  readOpponent,
  readColor,
  readClocks,
  readHandicaps,
  type StartPrefs,
  type PerSizeValues,
} from './useStartPrefs';
export * from './options';
