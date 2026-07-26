/**
 * Example bot: "power-hit" strategy -- actively uses the hit skill.
 *
 * Chases the ball's expected landing point, jumps to meet it, and smashes
 * whenever it gets the chance. Picks a steep downward smash (y=1) once
 * close enough to the net for that to safely clear, and an arcing nail
 * shot (y=-1) when still far away -- the y value at the moment of the hit
 * sets the smash angle (see docs/agent-dev/CONTRACTS.md §1.1).
 *
 * Works on either side (reads s.side itself) -- paste into the LEFT or
 * RIGHT textarea in the Bot Setup panel.
 *
 * Protocol reference: docs/agent-dev/CONTRACTS.md
 */
'use strict';

function decide(s) {
  var NET_X = 216; // GROUND_HALF_WIDTH
  var towardNet = s.side === 'RIGHT' ? -1 : 1;

  var dx = s.ball.expectedLandingPointX - s.self.x;
  var x = 0;
  if (Math.abs(dx) > 8) {
    x = dx > 0 ? 1 : -1;
  }

  var y = 0;
  var hit = 0;
  var closeEnough = Math.abs(s.ball.x - s.self.x) < 60;
  var ballAbove = s.ball.y < s.self.y - 20;

  if (s.self.state === 0 && closeEnough && ballAbove && s.ball.yVelocity > 0) {
    y = -1; // jump to meet the ball
  }
  if (s.self.state === 1 && closeEnough) {
    hit = 1; // power hit
    var distanceToNet = Math.abs(s.self.x - NET_X);
    if (distanceToNet < 80) {
      y = 1; // close to the net -- steep downward smash is safe
    } else {
      y = -1; // still far -- arc it over instead of driving it into the ground
    }
    // xDirection's sign doesn't steer the ball (the engine decides that
    // from which side of the net the ball is on) -- any nonzero value just
    // doubles hit speed. Move toward the net anyway to close the gap.
    x = towardNet;
  }

  return { x: x, y: y, hit: hit };
}
