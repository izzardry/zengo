/**
 * Strings owned by package "clock" (see PLAN.md). EN is the source of truth; DE du, FR vous, ES tú.
 *
 * The spoken reading of a byo-yomi clock for `role="timer"` (DESIGN 14.1), built by `spokenClock`
 * in lib/clock.ts: `{time}, {periods}` → `24 seconds, 3 periods`, `7 seconds, last period`,
 * `4:31, 3 periods`. Byo-yomi stays Japanese in every language (DESIGN 14); the custom dial's
 * strings live in start.ts with the dial.
 */
import { defineTable } from './define';

export default defineTable({
  en: {
    'clock.spoken': '{time}, {periods}',
    'clock.seconds': '{n} seconds',
    'clock.secondOne': '1 second',
    'clock.periods': '{n} periods',
    'clock.lastPeriod': 'last period',
  },
  de: {
    'clock.spoken': '{time}, {periods}',
    'clock.seconds': '{n} Sekunden',
    'clock.secondOne': '1 Sekunde',
    'clock.periods': '{n} Perioden',
    'clock.lastPeriod': 'letzte Periode',
  },
  fr: {
    'clock.spoken': '{time}, {periods}',
    'clock.seconds': '{n} secondes',
    'clock.secondOne': '1 seconde',
    'clock.periods': '{n} périodes',
    'clock.lastPeriod': 'dernière période',
  },
  es: {
    'clock.spoken': '{time}, {periods}',
    'clock.seconds': '{n} segundos',
    'clock.secondOne': '1 segundo',
    'clock.periods': '{n} periodos',
    'clock.lastPeriod': 'último periodo',
  },
});
