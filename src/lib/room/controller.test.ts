import { describe, expect, it } from 'vitest';
import { flagDelay, MAX_TIMER_MS } from './controller';

describe('flag timer delay', () => {
  it('waits for the time left, plus the grace for the opponent', () => {
    expect(flagDelay(5000, true, 2000)).toBe(5000);
    expect(flagDelay(5000, false, 2000)).toBe(7000);
    expect(flagDelay(-300, true, 2000)).toBe(0);
    expect(flagDelay(Number.NaN, true, 2000)).toBe(0);
  });

  it("never exceeds setTimeout's largest delay, which browsers would fire at once", () => {
    expect(MAX_TIMER_MS).toBe(2 ** 31 - 1);
    expect(flagDelay(2.4e9, true, 2000)).toBe(MAX_TIMER_MS);
    expect(flagDelay(MAX_TIMER_MS - 1000, false, 2000)).toBe(MAX_TIMER_MS);
    expect(flagDelay(Number.POSITIVE_INFINITY, true, 0)).toBe(MAX_TIMER_MS);
  });
});
