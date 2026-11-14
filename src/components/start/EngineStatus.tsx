/**
 * Offline state of the computer on the start screen (DESIGN 4.1, 14): download progress of stage 1
 * (TF.js + small net) on the first launch, of stage 2 (large net) when a level 8–12 is selected,
 * then "ready offline". When a stage is missing it says why, and a tap retries. Nothing is shown
 * while checking, where offline caching is unsupported, or while the computer is switched off
 * (`COMPUTER_ENABLED`).
 */
import { Check, Download, RotateCw, WifiOff } from 'lucide-react';
import type { EngineStage, EngineStatusLine } from '@/lib/engine/offline';
import { COMPUTER_ENABLED } from '@/lib/flags';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export interface EngineStatusProps {
  /** `useEngineOffline().line`. */
  line: EngineStatusLine;
  /** Starts (or retries) a stage's download: `useEngineOffline().download`. */
  onDownload: (stage: EngineStage) => void;
  /** Default `COMPUTER_ENABLED`; false renders nothing. */
  enabled?: boolean;
  className?: string;
}

// Each state fades in when it appears (the line is empty while the cache is checked), instead of popping in.
const LINE = 'flex h-6 animate-fade-in items-center justify-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground';

export function EngineStatus({ line, onDownload, enabled = COMPUTER_ENABLED, className }: EngineStatusProps) {
  const { t } = useI18n();
  if (!enabled || line.kind === 'none') return null;

  if (line.kind === 'downloading') {
    const large = line.stage === 2;
    return (
      <div className={cn(LINE, className)} data-testid="engine-status" data-status="downloading" data-stage={line.stage}>
        <span>{t(large ? 'engine.status.largeDownloading' : 'engine.status.downloading', { percent: line.percent })}</span>
        <span
          role="progressbar"
          aria-label={t(large ? 'engine.status.largeDownloadingAria' : 'engine.status.downloadingAria')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={line.percent}
          className="relative h-0.5 w-12 overflow-hidden rounded-full bg-foreground/15"
        >
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-foreground/60 transition-[width] duration-200 ease-out"
            style={{ width: `${line.percent}%` }}
          />
        </span>
      </div>
    );
  }

  if (line.kind === 'ready') {
    return (
      <div role="status" className={cn(LINE, 'text-muted-foreground/60', className)} data-testid="engine-status" data-status="ready">
        <Check aria-hidden className="h-3 w-3" />
        <span>{t('engine.status.ready')}</span>
      </div>
    );
  }

  if (line.kind === 'offline') {
    return (
      <div role="status" className={cn(LINE, className)} data-testid="engine-status" data-status="offline" data-stage={line.stage}>
        <WifiOff aria-hidden className="h-3 w-3" />
        <span>{t(line.stage === 2 ? 'engine.status.largeOffline' : 'engine.status.offline')}</span>
      </div>
    );
  }

  const failed = line.kind === 'failed';
  const Icon = failed ? RotateCw : Download;
  const label = failed ? 'engine.status.failed' : line.stage === 2 ? 'engine.status.largeSaveData' : 'engine.status.saveData';
  return (
    <button
      type="button"
      onClick={() => onDownload(line.stage)}
      className={cn(LINE, 'rounded-full px-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60', className)}
      data-testid="engine-status"
      data-status={line.kind}
      data-stage={line.stage}
    >
      <Icon aria-hidden className="h-3 w-3" />
      <span>{t(label)}</span>
    </button>
  );
}
