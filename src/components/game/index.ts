/**
 * Package 1C · Game chrome. Presentational components (props in, callbacks out) and helpers.
 * See each file for the full prop documentation.
 */
export { StatusBar, type StatusBarProps, type ToolbarMode, type HintControls } from './StatusBar';
export { ToolbarButton, type ToolbarButtonProps } from './ToolbarButton';
export { SeatingButton, type SeatingButtonProps } from './SeatingButton';
export { ShareMenu, type ShareMenuProps } from './ShareMenu';
export { InfoPill, type InfoPillProps, type InfoOpponent } from './InfoPill';
export { MoveList, type MoveListProps } from './MoveList';
export { PlayerStrip, type PlayerStripProps, type StripClock } from './PlayerStrip';
export { ScoringBar, ScoringAccept, type ScoringBarProps, type ScoringAcceptProps } from './ScoringBar';
export { GameOverOverlay, PageTint, TINT_MS, type GameOverOverlayProps, type PageTintProps } from './GameOverOverlay';
export {
  UndoToast,
  ResignUndoToast,
  PassUndoToast,
  RESIGN_UNDO_MS,
  PASS_UNDO_MS,
  type UndoToastProps,
  type ResignUndoToastProps,
  type PassUndoToastProps,
  type ToastPlacement,
} from './ResignUndoToast';
export { useShare, type ShareApi, type ShareKind } from './useShare';
export { shareOrCopy, copyText, type ShareOutcome, type ShareNavigator } from './share';
export { endTexts, outcomeFor, tintClass, tintFor, winner, type EndTexts, type Outcome, type Tint } from './outcome';
export { formatKomi, formatPoints, localHalf, moveLabel, other, plyInfo, scoreLine, scoreTotals } from './format';
