import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { DonationPrompt } from './DonationPrompt';
import { PWAInstallPrompt } from './PWAInstallPrompt';
import { InstallButton } from './InstallButton';
import { LanguageSwitcher } from './LanguageSwitcher';
import { EngineCredit, IzzardryFooter, NETWORKS_URL, SEARCH_URL } from './Credits';
import { SupportButton, SUPPORT_URL } from './SupportButton';
import { DeleteUndoToasts, type PendingDeletion } from './DeleteUndoToasts';
import { renderWithI18n } from './test-utils';
import { useI18n } from '@/lib/i18n';

describe('DonationPrompt', () => {
  it('asks once, gently, with the coffee button and a whisper dismiss', () => {
    const onDismiss = vi.fn();
    renderWithI18n(<DonationPrompt open onDismiss={onDismiss} />);
    expect(screen.getByRole('dialog', { name: 'Did you enjoy your first round?' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /buy me a coffee/i });
    expect(link).toHaveAttribute('href', SUPPORT_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    fireEvent.click(screen.getByRole('button', { name: 'maybe another time' }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('loads no outside image', () => {
    renderWithI18n(<DonationPrompt open onDismiss={() => {}} />);
    expect(document.querySelector('img')).toBeNull();
  });

  it('renders nothing while closed', () => {
    renderWithI18n(<DonationPrompt open={false} onDismiss={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is translated, including the close label', () => {
    renderWithI18n(<DonationPrompt open onDismiss={() => {}} />, 'es');
    expect(screen.getByRole('dialog', { name: '¿Te gustó tu primera partida?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeInTheDocument();
  });
});

describe('SupportButton', () => {
  it('links to Buy Me a Coffee in a new tab', () => {
    renderWithI18n(<SupportButton />);
    const link = screen.getByRole('link', { name: /buy me a coffee/i });
    expect(link).toHaveAttribute('href', 'https://www.buymeacoffee.com/holzschneider');
    expect(link.className).toContain('h-[60px]');
  });
});

describe('PWAInstallPrompt', () => {
  it('offers Install and Not now as pills', () => {
    const onInstall = vi.fn();
    const onDismiss = vi.fn();
    renderWithI18n(<PWAInstallPrompt onInstall={onInstall} onDismiss={onDismiss} />);
    expect(screen.getByRole('dialog', { name: 'Install Zengo' })).toBeInTheDocument();
    const install = screen.getByRole('button', { name: 'Install' });
    const notNow = screen.getByRole('button', { name: 'Not now' });
    expect(install.className).toContain('btn-primary');
    expect(notNow.className).toContain('btn-ghost');
    fireEvent.click(install);
    expect(onInstall).toHaveBeenCalled();
    fireEvent.click(notNow);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });
});

describe('InstallButton', () => {
  it('is the small pill', () => {
    const onClick = vi.fn();
    renderWithI18n(<InstallButton onClick={onClick} />, 'de');
    const btn = screen.getByRole('button', { name: 'App installieren' });
    expect(btn.className).toContain('pill-sm');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalled();
  });
});

describe('LanguageSwitcher', () => {
  function Probe() {
    const { language } = useI18n();
    return <span data-testid="lang">{language}</span>;
  }

  it('shows the current flag, lists native names, and switches', async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <>
        <LanguageSwitcher />
        <Probe />
      </>,
    );
    const trigger = screen.getByRole('button', { name: 'Change language: English' });
    expect(trigger).toHaveTextContent('🇬🇧');
    await user.click(trigger);
    expect(screen.getByRole('menuitem', { name: /English/ })).toHaveClass('font-bold');
    await user.click(screen.getByRole('menuitem', { name: /Deutsch/ }));
    expect(screen.getByTestId('lang')).toHaveTextContent('de');
    expect(screen.getByRole('button', { name: 'Sprache ändern: Deutsch' })).toHaveTextContent('🇩🇪');
    expect(document.documentElement.lang).toBe('de');
  });
});

describe('Credits', () => {
  it('credits the networks and the search with links to both (DESIGN 15.2)', () => {
    renderWithI18n(<EngineCredit />);
    expect(screen.getByText(/computer opponent:/)).toHaveTextContent(
      'computer opponent: KataGo networks (CC0), search after Web KaTrain (MIT)',
    );
    expect(NETWORKS_URL).toBe('https://katagoarchive.org/');
    expect(SEARCH_URL).toBe('https://github.com/Sir-Teo/web-katrain');
    const nets = screen.getByRole('link', { name: 'KataGo networks' });
    expect(nets).toHaveAttribute('href', NETWORKS_URL);
    expect(nets).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: 'Web KaTrain' })).toHaveAttribute('href', SEARCH_URL);
  });

  it('translates the credit', () => {
    renderWithI18n(<EngineCredit />, 'de');
    expect(screen.getByText(/Computergegner:/)).toHaveTextContent('Computergegner: KataGo-Netze (CC0), Suche nach Web KaTrain (MIT)');
  });

  it('signs as an izzardry game', () => {
    renderWithI18n(<IzzardryFooter />);
    expect(screen.getByText('an izzardry game')).toBeInTheDocument();
  });
});

describe('DeleteUndoToasts', () => {
  function Host({ onExpire = () => {} }: { onExpire?: () => void }) {
    const [list, setList] = useState<PendingDeletion<string>[]>([{ id: '1', subject: 'M00NLT', item: 'x' }]);
    return (
      <DeleteUndoToasts
        deletions={list}
        onUndo={(id) => setList((l) => l.filter((d) => d.id !== id))}
        onUndoAll={() => setList([])}
        onDismiss={(id) => setList((l) => l.filter((d) => d.id !== id))}
        onExpire={onExpire}
        durationMs={1000}
      />
    );
  }

  it('renders the subject in mono and the verb muted, in a polite live region', () => {
    renderWithI18n(<Host />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('M00NLT')).toHaveClass('font-mono');
    expect(screen.getByText('removed', { exact: false })).toHaveClass('text-muted-foreground');
  });

  it('keeps the subject where the language puts it', () => {
    renderWithI18n(<Host />, 'fr');
    expect(screen.getByRole('status')).toHaveTextContent('M00NLT supprimé');
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument();
  });

  it('expires after its lifetime', () => {
    vi.useFakeTimers();
    try {
      const onExpire = vi.fn();
      renderWithI18n(<Host onExpire={onExpire} />);
      act(() => vi.advanceTimersByTime(999));
      expect(onExpire).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      expect(onExpire).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
