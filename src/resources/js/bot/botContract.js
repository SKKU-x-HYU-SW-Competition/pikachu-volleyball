/**
 * Single source of truth for the bot input/output protocol.
 * Mirrors docs/agent-dev/CONTRACTS.md -- if this file and that document ever
 * disagree, update CONTRACTS.md first (bump its version, log the reason in
 * docs/agent-dev/DECISIONS.md), then change this file to match.
 */
'use strict';

// Physics engine constants (physics.js), re-exported here so the bot side
// never has to duplicate/guess them. Keep in sync with physics.js if the
// original reverse-engineered constants ever change (they shouldn't).
export const GROUND_WIDTH = 432;
export const GROUND_HALF_WIDTH = 216;
export const PLAYER_TOUCHING_GROUND_Y_COORD = 244;
export const BALL_TOUCHING_GROUND_Y_COORD = 252;
export const BALL_RADIUS = 20;
export const PLAYER_LENGTH = 64;
export const PLAYER_HALF_LENGTH = 32;
export const NET_PILLAR_HALF_WIDTH = 25;
export const NET_PILLAR_TOP_TOP_Y_COORD = 176;
export const NET_PILLAR_TOP_BOTTOM_Y_COORD = 192;

/** @constant @type {number} original game's normal frames-per-second */
export const NORMAL_FPS = 25;
/** @constant @type {number} nominal length of one engine frame in ms */
export const MS_PER_FRAME = 1000 / NORMAL_FPS; // 40

/**
 * How many engine frames make up one bot decision tick (decision D-001).
 * Kept as a named constant (not hardcoded at call sites) precisely because
 * it may need to change after real testing in Phase 2.
 * @constant @type {number}
 */
export const TICK_FRAME_GROUP_SIZE = 1;

/**
 * How long to wait for a bot's Worker to respond before treating the tick
 * as a timeout (decision D-002). Generous relative to MS_PER_FRAME because
 * a slow tick doesn't corrupt the match (see D-009) -- this is a safety net
 * against hangs, not a tight real-time budget.
 * @constant @type {number}
 */
export const BOT_RESPONSE_TIMEOUT_MS = MS_PER_FRAME * TICK_FRAME_GROUP_SIZE * 3;

/**
 * If a bot's Worker times out this many ticks in a row, it's treated as
 * hung and forcibly restarted (decision D-003).
 * @constant @type {number}
 */
export const MAX_CONSECUTIVE_TIMEOUTS_BEFORE_RESTART = 15;

/** @constant @type {{x: 0, y: 0, hit: 0}} fallback action used on timeout/invalid response */
export const NEUTRAL_ACTION = Object.freeze({ x: 0, y: 0, hit: 0 });

/**
 * Is this a well-formed bot action? (decision D-002: anything else -> neutral)
 * @param {*} action
 * @return {boolean}
 */
export function isValidBotAction(action) {
  return (
    !!action &&
    (action.x === -1 || action.x === 0 || action.x === 1) &&
    (action.y === -1 || action.y === 0 || action.y === 1) &&
    (action.hit === 0 || action.hit === 1)
  );
}

/**
 * Build the per-tick game state snapshot handed to a bot (engine -> bot).
 * Pure function: only reads from the given physics/meta objects, never
 * mutates them. See docs/agent-dev/CONTRACTS.md §1.2 for field-by-field
 * rationale.
 *
 * @param {Object} args
 * @param {number} args.tick monotonically increasing tick counter
 * @param {'LEFT'|'RIGHT'} args.side which side this bot controls
 *   ('LEFT' must occupy keyboardArray[0], 'RIGHT' must occupy keyboardArray[1],
 *   matching how physicsEngine pairs userInputArray[i] with player1/player2)
 * @param {import('../physics.js').PikaPhysics} args.physics
 * @param {{scores: number[], isPlayer2Serve: boolean}} args.meta
 * @param {number} args.rallyFrameCount ticks elapsed since the current rally started
 * @return {Object} snapshot, matching CONTRACTS.md §1.2
 */
export function buildGameStateSnapshot({
  tick,
  side,
  physics,
  meta,
  rallyFrameCount,
}) {
  const isPlayer2 = side === 'RIGHT';
  const selfPlayer = isPlayer2 ? physics.player2 : physics.player1;
  const oppPlayer = isPlayer2 ? physics.player1 : physics.player2;

  const toPlayerView = (player) => ({
    x: player.x,
    y: player.y,
    state: player.state,
    frameNumber: player.frameNumber,
    divingDirection: player.divingDirection,
  });

  return {
    tick,
    side,
    self: toPlayerView(selfPlayer),
    opp: toPlayerView(oppPlayer),
    ball: {
      x: physics.ball.x,
      y: physics.ball.y,
      xVelocity: physics.ball.xVelocity,
      yVelocity: physics.ball.yVelocity,
      isPowerHit: physics.ball.isPowerHit,
      expectedLandingPointX: physics.ball.expectedLandingPointX,
    },
    meta: {
      score: {
        self: isPlayer2 ? meta.scores[1] : meta.scores[0],
        opp: isPlayer2 ? meta.scores[0] : meta.scores[1],
      },
      isPlayer2Serve: meta.isPlayer2Serve,
      rallyFrameCount: rallyFrameCount,
    },
    config: {
      tickFrameGroupSize: TICK_FRAME_GROUP_SIZE,
    },
  };
}
