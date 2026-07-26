/**
 * Example bot: "positioning only" -- never uses the hit skill.
 *
 * hit is always 0, so this bot never power-hits or dives (diving also
 * requires hit=1 in this engine). Its only tool is getting its body in the
 * ball's path -- the engine still bounces the ball off a player on a plain
 * (non-power) touch, it's just a weaker deflection instead of a controlled
 * smash: physics.js's processCollisionBetweenBallAndPlayer sets
 * ball.xVelocity based on which side of the player's center the ball
 * landed on, not toward a fixed direction. So instead of standing exactly
 * under the ball's expected landing point, this bot aims slightly to the
 * far side of it (away from the net) -- that way, at the moment of
 * contact, the ball is on the net side of its own center, and the default
 * bounce sends it forward instead of straight back into its own court.
 *
 * Works on either side (reads s.side itself) -- paste into the LEFT or
 * RIGHT textarea in the Bot Setup panel.
 *
 * Also mirrors a bit of the built-in AI's positioning logic
 * (physics.js letComputerDecideUserInput, roughly lines 808-824): while the
 * ball's predicted landing point is still on the *opponent's* side, don't
 * crowd the net chasing it -- fall back to the middle of our own court and
 * wait. Otherwise a bot that always chases expectedLandingPointX ends up
 * glued to the net every time the ball is on the other side (since that's
 * still the closest point to the -- currently irrelevant -- landing spot),
 * which is a bad spot to defend from once the ball actually comes back.
 *
 * Protocol reference: docs/agent-dev/CONTRACTS.md
 */
'use strict';

function decide(s) {
  var NET_X = 216; // GROUND_HALF_WIDTH
  var GROUND_WIDTH = 432;
  var towardNet = s.side === 'RIGHT' ? -1 : 1;

  var ownNearBoundary = s.side === 'RIGHT' ? NET_X : 0;
  var ownFarBoundary = s.side === 'RIGHT' ? GROUND_WIDTH : NET_X;
  var standbyX = (ownNearBoundary + ownFarBoundary) / 2; // middle of our own court

  var landingOnOwnSide =
    s.ball.expectedLandingPointX > ownNearBoundary &&
    s.ball.expectedLandingPointX < ownFarBoundary;

  var targetX;
  if (landingOnOwnSide) {
    // Ball is actually coming to us -- aim a little past the landing
    // point, on the side away from the net, so the ball ends up on our
    // net-side at contact (see file header comment).
    targetX = s.ball.expectedLandingPointX - towardNet * 12;
  } else {
    // Still on the opponent's side -- retreat to our standby spot instead
    // of chasing a landing point that isn't coming to us.
    targetX = standbyX;
  }

  var dx = targetX - s.self.x;
  var x = 0;
  if (Math.abs(dx) > 6) {
    x = dx > 0 ? 1 : -1;
  }

  var y = 0;
  // A standing player already gets credit for contact with any ball within
  // PLAYER_HALF_LENGTH (32px) both horizontally *and* vertically
  // (physics.js isCollisionBetweenBallAndPlayerHappened). A ball merely
  // "a bit above" that band isn't a good reason to jump on its own -- a
  // low, fast, flat ball (e.g. off the back wall) can cross from "just
  // above reach" to "touching the ground" in a couple of frames, faster
  // than a jump can rise and come back down to meet it. That's what a
  // mistimed "ball lands while I'm still in the air" jump looks like.
  //
  // This mirrors the built-in AI's actual jump condition
  // (physics.js:839-848, letComputerDecideUserInput): only jump when the
  // ball is (a) tightly x-aligned (within the same 32px hitbox, not just
  // "close-ish"), (b) not currently moving fast sideways -- if it is,
  // it'll clear us before a jump could line up -- and (c) genuinely high
  // up, not just past the standing-reach line.
  var PLAYER_HALF_LENGTH = 32;
  var xAligned = Math.abs(s.ball.x - s.self.x) < PLAYER_HALF_LENGTH;
  var ballSlowSideways = Math.abs(s.ball.xVelocity) < 5;
  var ballClearlyHigh = s.ball.y < 150;
  if (
    s.self.state === 0 &&
    xAligned &&
    ballSlowSideways &&
    ballClearlyHigh &&
    s.ball.yVelocity > 0
  ) {
    // Jumping is just movement, not the hit skill -- fine to use here.
    y = -1;
  }

  // Always 0: no power-hit, no diving.
  return { x: x, y: y, hit: 0 };
}
