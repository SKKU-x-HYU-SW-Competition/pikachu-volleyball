/**
 * Gauge -- the resource that skills will be bought with (decision D-020).
 *
 * This module deliberately contains no rendering and no engine mutation: it is
 * a pure observer that watches the physics engine's existing per-contact flag
 * and keeps a number per player. See gaugeView.js for drawing and setup.js for
 * the wiring.
 */
'use strict';

/** @constant @type {number} */
export const GAUGE_MIN = 0;
/** @constant @type {number} */
export const GAUGE_MAX = 100;
/** @constant @type {number} gauge both players start a match with */
export const GAUGE_INITIAL = 0;

/**
 * Gained when receiving a ball that came from the opponent, i.e. the first
 * touch after the other player touched it. Ten clean one-touch returns fill
 * the gauge.
 * @constant @type {number}
 */
export const GAUGE_ON_RECEIVE = 10;

/**
 * Applied when touching the ball again on one's own side instead of sending it
 * over. Makes a two-touch return worth +5 net, three-touch 0, four-touch -5.
 * @constant @type {number}
 */
export const GAUGE_ON_EXTRA_TOUCH = -5;

/**
 * Applied to the first contact of a rally (the serve). Zero because the
 * original game already awards the serve to whoever just scored
 * (pikavolley.js:374-386), so paying gauge on top of it would compound the
 * lead. If the serve rule ever changes to "loser serves" or "alternating
 * serve", D-020 says this becomes GAUGE_ON_RECEIVE -- this constant is the
 * only thing that needs to change.
 * @constant @type {number}
 */
export const GAUGE_ON_SERVE = 0;

/**
 * The gauge rules as the bots see them in their snapshot's `config.gauge`
 * (CONTRACTS.md 1.2.1, D-023). Exposed rather than left for bots to hardcode
 * for the same reason as CLAW_SNAPSHOT_CONFIG: these are tuning stubs, and a
 * bot planning "one clean return and I can afford a claw" must plan against
 * the numbers actually in force.
 * @constant
 */
export const GAUGE_SNAPSHOT_CONFIG = Object.freeze({
  min: GAUGE_MIN,
  max: GAUGE_MAX,
  onReceive: GAUGE_ON_RECEIVE,
  onExtraTouch: GAUGE_ON_EXTRA_TOUCH,
  onServe: GAUGE_ON_SERVE,
});

/**
 * Tracks a gauge per player by observing the physics engine from the outside.
 *
 * The engine sets player.isCollisionWithBallHappened to true on contact and
 * back to false once the ball leaves the player's box (physics.js:345-360), so
 * a false -> true transition is exactly one "hit the ball" event. Sampling
 * that every tick means the whole feature needs no change to physics.js --
 * same approach bot/testSetup.js already uses for keyboardArray.
 */
export class GaugeTracker {
  constructor() {
    /** @type {number[]} gauge of [player1, player2] */
    this.gauges = [GAUGE_INITIAL, GAUGE_INITIAL];

    /**
     * Who touched the ball last in the current rally, or null if nobody has
     * yet. null is what makes the next contact count as a serve, so it is
     * reset on every rally boundary rather than only at match start.
     * @type {number|null} 0, 1 or null
     */
    this.lastToucherIndex = null;

    /** @type {boolean[]} previous tick's collision flags, for edge detection */
    this.previousCollisionFlags = [false, false];

    /** @type {boolean} whether the previous tick was inside startOfNewGame */
    this.wasStartingNewGame = false;
  }

  /**
   * Reset both gauges. Called when a new match starts (D-020: gauge survives
   * rallies but not matches).
   */
  resetForNewGame() {
    this.gauges = [GAUGE_INITIAL, GAUGE_INITIAL];
    this.lastToucherIndex = null;
    this.previousCollisionFlags = [false, false];
  }

  /**
   * Gauge of one player, for rendering and (later) skill affordability checks.
   * @param {number} playerIndex 0 or 1
   * @return {number} in [GAUGE_MIN, GAUGE_MAX]
   */
  getGauge(playerIndex) {
    return this.gauges[playerIndex];
  }

  /**
   * Pay for a skill. All-or-nothing: a player who cannot afford the cost
   * spends nothing, so callers can use the return value as the "can I cast?"
   * check without asking twice.
   * @param {number} playerIndex 0 or 1
   * @param {number} amount gauge to spend, e.g. CLAW_COST
   * @return {boolean} whether the gauge was actually spent
   */
  trySpend(playerIndex, amount) {
    if (this.gauges[playerIndex] < amount) {
      return false;
    }
    this.gauges[playerIndex] = clamp(this.gauges[playerIndex] - amount);
    return true;
  }

  /**
   * Apply one ball contact by the given player.
   * @param {number} playerIndex 0 or 1
   */
  registerTouch(playerIndex) {
    let delta;
    if (this.lastToucherIndex === null) {
      delta = GAUGE_ON_SERVE;
    } else if (this.lastToucherIndex === playerIndex) {
      delta = GAUGE_ON_EXTRA_TOUCH;
    } else {
      delta = GAUGE_ON_RECEIVE;
    }
    this.gauges[playerIndex] = clamp(this.gauges[playerIndex] + delta);
    this.lastToucherIndex = playerIndex;
  }

  /**
   * Observe one tick of the game. Must be called after pikaVolley.gameLoop()
   * so that the flags reflect the frame that was just simulated.
   * @param {import('../pikavolley.js').PikachuVolleyball} pikaVolley
   */
  observe(pikaVolley) {
    // A match starts in startOfNewGame, which is also where scores are zeroed
    // (pikavolley.js:287-300). Reset on the transition into it, not on every
    // frame of it, since that state lasts 71 frames.
    const isStartingNewGame = pikaVolley.state === pikaVolley.startOfNewGame;
    if (isStartingNewGame && !this.wasStartingNewGame) {
      this.resetForNewGame();
    }
    this.wasStartingNewGame = isStartingNewGame;

    // Contacts only happen while the engine runs, which is only in round().
    // Leaving round() therefore means the rally is over, so the next contact
    // is a serve.
    if (pikaVolley.state !== pikaVolley.round) {
      this.lastToucherIndex = null;
      this.previousCollisionFlags = [false, false];
      return;
    }

    const players = [pikaVolley.physics.player1, pikaVolley.physics.player2];
    for (let i = 0; i < 2; i++) {
      const isColliding = players[i].isCollisionWithBallHappened;
      if (isColliding && !this.previousCollisionFlags[i]) {
        this.registerTouch(i);
      }
      this.previousCollisionFlags[i] = isColliding;
    }
  }
}

/**
 * @param {number} value
 * @return {number} value clamped into [GAUGE_MIN, GAUGE_MAX]
 */
function clamp(value) {
  return Math.max(GAUGE_MIN, Math.min(GAUGE_MAX, value));
}
