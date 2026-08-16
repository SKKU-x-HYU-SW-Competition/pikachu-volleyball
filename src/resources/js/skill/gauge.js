/**
 * Gauge -- the resource that skills will be bought with (decision D-020).
 *
 * This module deliberately contains no rendering and no engine mutation: it is
 * a pure observer that watches the physics engine's existing per-contact flag
 * and keeps a number per player. See gaugeView.js for drawing and setup.js for
 * the wiring.
 */
'use strict';
import { isRallyLive } from './rally.js';

/** @constant @type {number} */
export const GAUGE_MIN = 0;
/** @constant @type {number} */
export const GAUGE_MAX = 100;
/** @constant @type {number} gauge both players start a match with */
export const GAUGE_INITIAL = 0;

/**
 * Gained when receiving a ball that came from the opponent, i.e. the first
 * touch after the other player touched it. Five clean one-touch returns fill
 * the gauge.
 * @constant @type {number}
 */
export const GAUGE_ON_RECEIVE = 20;

/**
 * Applied on top of the touch value when that touch is a power hit -- a smash.
 * The engine flags one on the ball itself (`ball.isPowerHit`, physics.js:708-727:
 * true only when the hitter was in `playerState === 2` at the moment of
 * collision), so no engine change is needed to see it.
 *
 * This makes the gauge a choice rather than a by-product: a smash is the
 * strongest return in the game, so paying for it means a player who spikes
 * every ball never banks a skill, while one who returns softly builds toward
 * a claw. Note it stacks with the touch value above -- receiving *and*
 * smashing in one touch nets GAUGE_ON_RECEIVE + GAUGE_ON_SMASH.
 * @constant @type {number}
 */
export const GAUGE_ON_SMASH = -10;

/**
 * Applied to the first contact of a rally (the serve). A serve is not a
 * receive -- nobody had to read and reach a ball to make it -- so it earns
 * nothing. Tuning stub like the rest of this file.
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
  onSmash: GAUGE_ON_SMASH,
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
   * @param {boolean} isSmash whether this contact was a power hit
   */
  registerTouch(playerIndex, isSmash) {
    // Only the first touch after the opponent's -- the receive -- pays. A
    // second touch on one's own side is worth nothing rather than costing
    // gauge: the five-touch cap (rules/touchLimit.js) already punishes
    // holding onto the ball, so charging for it twice was redundant.
    let delta = 0;
    if (this.lastToucherIndex === null) {
      delta = GAUGE_ON_SERVE;
    } else if (this.lastToucherIndex !== playerIndex) {
      delta = GAUGE_ON_RECEIVE;
    }
    // Independent of which kind of touch it was, so a receive that is also a
    // smash nets the two together.
    if (isSmash) {
      delta += GAUGE_ON_SMASH;
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

    // Only contacts inside a live rally charge the gauge. Note this is not the
    // same as "the engine is running": it keeps running for ~1.2s after the
    // ball lands and through the game-end message, and hits in those windows
    // used to charge the gauge (D-024). Once the rally is over the next
    // contact is a serve, so the last-toucher memory is cleared here.
    if (!isRallyLive(pikaVolley)) {
      this.lastToucherIndex = null;
      this.previousCollisionFlags = [false, false];
      return;
    }

    const players = [pikaVolley.physics.player1, pikaVolley.physics.player2];
    // The engine rewrites ball.isPowerHit on every collision and nowhere else
    // (physics.js:708-727), so read at the exact frame a contact begins it
    // describes that contact.
    const isSmash = pikaVolley.physics.ball.isPowerHit === true;
    for (let i = 0; i < 2; i++) {
      const isColliding = players[i].isCollisionWithBallHappened;
      if (isColliding && !this.previousCollisionFlags[i]) {
        this.registerTouch(i, isSmash);
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
