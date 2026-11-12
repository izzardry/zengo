/**
 * Board package (1A). Import from `@/components/board`.
 */
export { GoBoard } from './GoBoard';
export { BoardThumbnail, type BoardThumbnailProps } from './BoardThumbnail';
export { StoneGlyph, StoneDefs, StoneShape, StoneGradients, type StoneGlyphProps } from './stones';
export { STONE_FILL, STONE_CONTRAST, STONE_OUTLINE } from './paint';
export { goBoardGameProps, useGoBoardGame, type GoBoardGameProps } from './gameProps';
export {
  countCaptures,
  describeAtari,
  describeMove,
  describePoint,
  sideName,
  type PointInfo,
  type Translate,
} from './describe';
export {
  BOARD_SIZE_LANDSCAPE,
  BOARD_SIZE_PORTRAIT,
  GTP_COLUMNS,
  LIFT_PX,
  MARGIN,
  STONE_R,
  centerPoint,
  cellToPoint,
  columnLabel,
  extent,
  inGhostHitArea,
  pointAt,
  pointCenter,
  pointName,
  pointToCell,
  rowLabel,
  starSet,
  stepPoint,
  viewBox,
  type Box,
} from './geometry';
export type { BoardHint, BoardScoring, GoBoardProps, TerritoryPreview } from './types';
