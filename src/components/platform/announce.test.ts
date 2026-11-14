import { describe, expect, it } from 'vitest';
import { translate, type Language, type TranslationKey, type TranslationVars } from '@/lib/i18n';
import { fromDiagram, fromGtp, makeSettings, newGame, pass, play } from '@/lib/zengo';
import type { Game } from '@/lib/types';
import {
  atariAnnouncement,
  moveAnnouncement,
  newAtariAnnouncements,
  passAnnouncement,
  plyAnnouncement,
} from './announce';

const tFor = (lang: Language) => (key: TranslationKey, vars?: TranslationVars) => translate(lang, key, vars);
const t = tFor('en');
const P = (s: string, size: 9 | 13 | 19 = 9) => fromGtp(s, size)!;

describe('live region texts (DESIGN 14.1)', () => {
  it('announces a stone with its captures', () => {
    expect(moveAnnouncement(t, 'B', P('D4'), 9)).toBe('Black: D4');
    expect(moveAnnouncement(t, 'B', P('D4'), 9, 2)).toBe('Black: D4, captures 2');
    expect(moveAnnouncement(t, 'W', P('Q16', 19), 19, 1)).toBe('White: Q16, captures 1');
  });

  it('announces a pass', () => {
    expect(passAnnouncement(t, 'W')).toBe('White passes');
    expect(passAnnouncement(t, 'B')).toBe('Black passes');
  });

  it('announces atari for this device or by color', () => {
    expect(atariAnnouncement(t, P('C3'), 9, 'you')).toBe('Your group at C3 is in atari');
    expect(atariAnnouncement(t, P('C3'), 9, 'B')).toBe("Black's group at C3 is in atari");
    expect(atariAnnouncement(t, P('C3'), 9, 'W')).toBe("White's group at C3 is in atari");
  });

  it('is translated with the Go glossary', () => {
    expect(moveAnnouncement(tFor('de'), 'B', P('D4'), 9, 2)).toBe('Schwarz: D4, 2 Gefangene');
    expect(moveAnnouncement(tFor('de'), 'B', P('D4'), 9, 1)).toBe('Schwarz: D4, 1 Gefangener');
    expect(passAnnouncement(tFor('de'), 'W')).toBe('Weiß passt');
    expect(atariAnnouncement(tFor('de'), P('C3'), 9, 'you')).toBe('Deine Gruppe auf C3 steht im Atari');
    expect(moveAnnouncement(tFor('fr'), 'W', P('D4'), 9, 3)).toBe('Blanc : D4, 3 prisonniers');
    expect(passAnnouncement(tFor('fr'), 'B')).toBe('Noir passe');
    expect(atariAnnouncement(tFor('fr'), P('C3'), 9, 'you')).toBe('Votre groupe en C3 est en atari');
    expect(moveAnnouncement(tFor('es'), 'B', P('D4'), 9, 2)).toBe('Negro: D4, 2 capturas');
    expect(passAnnouncement(tFor('es'), 'B')).toBe('Negro pasa');
    expect(atariAnnouncement(tFor('es'), P('C3'), 9, 'you')).toBe('Tu grupo en C3 está en atari');
  });

  describe('from a game', () => {
    it('names the ply that was just played, with its captures', () => {
      // White A9 in the corner, Black A8 below it: Black B9 takes its last liberty.
      const g0: Game = fromDiagram(
        [
          'O........',
          'X........',
          '.........',
          '.........',
          '.........',
          '.........',
          '.........',
          '.........',
          '.........',
        ],
        'B',
      );
      const g1 = play(g0, P('B9'), 1000);
      expect(plyAnnouncement(t, g0, g1)).toBe('Black: B9, captures 1');
      const g2 = pass(g1, 1000);
      expect(plyAnnouncement(t, g1, g2)).toBe('White passes');
      // Not one ply apart.
      expect(plyAnnouncement(t, g0, g2)).toBeNull();
    });

    it('lists only groups that newly entered atari', () => {
      const g0 = newGame(makeSettings(9));
      const g1 = play(g0, P('A1'), 0); // B A1: two liberties
      const g2 = play(g1, P('B1'), 0); // W B1: Black A1 is in atari
      expect(newAtariAnnouncements(t, g1, g2, 'B', 'you')).toEqual(['Your group at A1 is in atari']);
      const g3 = play(g2, P('E5'), 0);
      expect(newAtariAnnouncements(t, g2, g3, 'B', 'you')).toEqual([]);
      expect(newAtariAnnouncements(t, null, g3, 'B')).toEqual(["Black's group at A1 is in atari"]);
    });
  });
});
