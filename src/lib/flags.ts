/**
 * Feature flags.
 *
 * The overnight build switches a non-foundational feature off here when it still fails its
 * tests after three fix rounds (PLAN.md section 1, rule 4). Every flag set to `false` must
 * have a matching entry under "Open items" in docs/BUILD-LOG.md. Code that renders or runs
 * a flagged feature checks the flag and hides the feature cleanly when it is off.
 */
const defaults = {
  /** Milestone 2: the computer opponent (KataGo networks in a worker). */
  computer: true,
  /** Milestone 2: the game clock (Fischer and byo-yomi). */
  clock: true,
  /** Milestone 2: the hint bulb (tap: best point, hold: territory preview). */
  hint: true,
  /** Milestone 2: the blunder guard inside the helpers shield. */
  blunderGuard: true,
  /** Milestone 3: peer-to-peer rooms. */
  rooms: true,
  /** Milestone 3: rooms through the public PeerJS broker. */
  peerjsBroker: true,
  /** Milestone 3: manual link + QR signalling fallback. */
  manualSignalling: true,
  /** Platform: coach-mark tutorial on the first game. */
  tutorial: true,
  /** Platform: once-only donation prompt after the first win. */
  donationPrompt: true,
  /** Platform: install bottom sheet and pill. */
  installPrompt: true,
};

export type FeatureFlag = keyof typeof defaults;

/** Typed as plain booleans so code can test a flag either way without literal-type errors. */
export const flags: Readonly<Record<FeatureFlag, boolean>> = defaults;

/**
 * Milestone switch, not a failure flag: the computer engine exists from milestone 2 on (package 2A
 * sets this to `true`). While it is `false`, nothing engine-related runs: `useEngineOffline`
 * downloads nothing and reports `unsupported`, and `EngineStatus` renders nothing. Typed as a
 * plain boolean so code can test it either way.
 */
export const COMPUTER_ENABLED: boolean = false;
