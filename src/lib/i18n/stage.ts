/** Strings owned by the stage (pages/Index.tsx, Integrator 1). EN is the source of truth; DE du, FR vous, ES tú. */
import { defineTable } from './define';

export default defineTable({
  en: {
    'stage.ko': 'Ko: play elsewhere before you take back',
    'stage.superko': 'Superko: this would repeat an earlier position',
  },
  de: {
    'stage.ko': 'Ko: Spiel erst woanders, bevor du zurückschlägst',
    'stage.superko': 'Superko: Das wiederholt eine frühere Stellung',
  },
  fr: {
    'stage.ko': 'Ko : jouez ailleurs avant de reprendre',
    'stage.superko': 'Superko : cette position a déjà eu lieu',
  },
  es: {
    'stage.ko': 'Ko: juega en otro sitio antes de recapturar',
    'stage.superko': 'Superko: repetiría una posición anterior',
  },
});
