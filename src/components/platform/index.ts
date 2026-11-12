/** Package 1E · Platform: history, undo toasts, tutorial, donation, install, language, credits, live-region texts. */
export { GameHistory, type GameHistoryProps } from './GameHistory';
export { GameCard, THUMBNAIL_SIZE, type GameCardProps, type RenderThumbnail } from './GameCard';
export { DeleteUndoToasts, UNDO_TOAST_MS, type DeleteUndoToastsProps, type PendingDeletion } from './DeleteUndoToasts';
export { useUndoDeletions, type UndoDeletions } from './useUndoDeletions';
export { useSwipeToDelete, prefersReducedMotion } from './useSwipeToDelete';
export { TutorialOverlay, TUTORIAL_EXIT_MS, type TutorialOverlayProps } from './TutorialOverlay';
export { DonationPrompt, type DonationPromptProps } from './DonationPrompt';
export { SupportButton, SUPPORT_URL, type SupportButtonProps } from './SupportButton';
export { PWAInstallPrompt, type PWAInstallPromptProps } from './PWAInstallPrompt';
export { InstallButton, type InstallButtonProps } from './InstallButton';
export { LanguageSwitcher, type LanguageSwitcherProps } from './LanguageSwitcher';
export { EngineCredit, IzzardryFooter, NETWORKS_URL, SEARCH_URL } from './Credits';
export {
  atariAnnouncement,
  colorName,
  moveAnnouncement,
  newAtariAnnouncements,
  passAnnouncement,
  plyAnnouncement,
  type Translate,
} from './announce';
export {
  RECENT_GAMES,
  HISTORY_GROUPS,
  cardState,
  formatPoints,
  formatRelativeTime,
  formatRoomScore,
  gameOf,
  groupByTime,
  groupOf,
  moveCount,
  plyCount,
  roomOf,
  sideToMove,
  sizeLabel,
  sizeOf,
  sortByRecent,
  type CardState,
  type HistoryGroup,
} from './history';
