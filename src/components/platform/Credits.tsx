/**
 * Credit lines at the bottom of the start screen's scroll area:
 *
 * - `EngineCredit`: `computer opponent: KataGo networks (CC0), search after Web KaTrain (MIT)`
 *   (DESIGN 15.2), linking to the KataGo network archive and to Web KaTrain.
 * - `IzzardryFooter`: `an izzardry game` (Ztyle 01), lowercase, 10 px, muted at 40 %.
 */
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** Where the CC0 KataGo networks in public/engine/nets come from. */
export const NETWORKS_URL = 'https://katagoarchive.org/';
/** The MIT project the engine's search is ported from. */
export const SEARCH_URL = 'https://github.com/Sir-Teo/web-katrain';

const link = 'text-muted-foreground/80 hover:text-foreground transition-colors';

export function EngineCredit({ className }: { className?: string }) {
  const { t } = useI18n();
  return (
    <p className={cn('text-[10px] text-muted-foreground/60 text-center', className)}>
      {t('platform.credits.engine')}:{' '}
      <a href={NETWORKS_URL} target="_blank" rel="noopener noreferrer" className={link}>
        {t('platform.credits.networks')}
      </a>{' '}
      (CC0), {t('platform.credits.searchAfter')}{' '}
      <a href={SEARCH_URL} target="_blank" rel="noopener noreferrer" className={link}>
        Web KaTrain
      </a>{' '}
      (MIT)
    </p>
  );
}

export function IzzardryFooter({ className }: { className?: string }) {
  const { t } = useI18n();
  return <p className={cn('text-[10px] lowercase text-muted-foreground/40 text-center', className)}>{t('platform.credits.footer')}</p>;
}
