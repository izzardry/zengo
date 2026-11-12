/**
 * A static drawing of the start screen's preview position (`previewGame`), for use inside
 * `BoardPreview` where the full interactive board is not rendered. Stones and star points only;
 * the caller sizes it (it fills its box by default).
 */
import { useMemo, type CSSProperties } from 'react';
import { BoardThumbnail } from '@/components/board';
import type { SavedGame } from '@/lib/types';
import { cn } from '@/lib/utils';
import { previewGame, type PreviewSettings } from './preview';

export interface PreviewBoardProps extends PreviewSettings {
  /** The saved game the code refers to; its position replaces the empty board. */
  readonly saved?: SavedGame | null;
  readonly className?: string;
  readonly style?: CSSProperties;
}

export function PreviewBoard({ size, rules, handicap, saved, className, style }: PreviewBoardProps) {
  const game = useMemo(() => previewGame({ size, rules, handicap }, saved), [size, rules, handicap, saved]);
  return (
    <div className={cn('h-full w-full', className)} style={style} data-testid="preview-board" data-size={game.settings.size}>
      <BoardThumbnail size={game.settings.size} board={game.board} className="h-full w-full" />
    </div>
  );
}
