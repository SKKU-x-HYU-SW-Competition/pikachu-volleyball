/**
 * Example bot sources, loaded by testSetup.js's "Load example bot" button.
 * Not part of the protocol spec -- just minimal "does the plumbing work"
 * demonstrations: chase the ball's expected landing point and jump/smash
 * when close. Kept as plain source text (not real ES modules) because
 * they're sent to the bot Worker as strings and evaluated there, exactly
 * like a participant's submitted bot would be.
 *
 * CHASE_BOT_SOURCE and CHASE_BOT_SOURCE_PY are direct ports of the same
 * strategy in JS and Python respectively -- keep them behaviorally
 * equivalent so participants can compare their bot's structure across
 * languages.
 */
'use strict';

export const CHASE_BOT_SOURCE = `
// Persistent across ticks: this whole source runs once through new Function()
// in botWorker.js, and the returned decide() closes over these -- they are
// NOT reset every call.
var tickCounter = 0;
var LOG_EVERY_N_TICKS = 100;
var NET_X = 216; // GROUND_HALF_WIDTH, see CONTRACTS.md §1.2

function decide(s) {
  tickCounter++;

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
    hit = 1;
    // xDirection's sign does NOT steer which way the ball goes -- the engine
    // decides that from which side of the net the ball is on (physics.js
    // processCollisionBetweenBallAndPlayer). It only doubles hit speed.
    // What actually determines whether a downward smash clears the net is
    // how much horizontal distance it has to cover before gravity + the
    // steep y=1 angle bring it back down -- so only go for the full
    // downward smash once we're close enough to the net for that distance
    // to be safe; otherwise arc it over with y=-1 instead of driving it
    // into our own court.
    var distanceToNet = Math.abs(s.self.x - NET_X);
    if (distanceToNet < 80) {
      y = 1; // close to the net -- steep smash is safe
    } else {
      y = -1; // still far -- arc it over instead of spiking it into the ground
    }
    var towardNet = s.side === 'RIGHT' ? -1 : 1;
    x = towardNet; // also close the distance to the net on this hit (+ speed boost, any xDirection doubles it)
  }

  if (tickCounter % LOG_EVERY_N_TICKS === 0) {
    console.log(
      '[bot ' + s.side + '] tick=' + s.tick +
      ' state=' + s.self.state +
      ' self=(' + s.self.x + ',' + s.self.y + ')' +
      ' ball=(' + s.ball.x + ',' + s.ball.y + ')' +
      ' landingX=' + s.ball.expectedLandingPointX +
      ' -> x=' + x + ' y=' + y + ' hit=' + hit
    );
  }

  return { x: x, y: y, hit: hit };
}
`;

export const CHASE_BOT_SOURCE_PY = `
# Persistent across ticks: this whole source is exec()'d once by
# botWorkerPython.js and the returned decide() closes over these module
# globals -- they are NOT reset every call.
tick_counter = 0
LOG_EVERY_N_TICKS = 20  # decide() runs every TICK_FRAME_GROUP_SIZE frames -- 20 ~= 4s
NET_X = 216  # GROUND_HALF_WIDTH, see CONTRACTS.md §1.2

def decide(s):
    global tick_counter
    tick_counter += 1

    dx = s['ball']['expectedLandingPointX'] - s['self']['x']
    x = 0
    if abs(dx) > 8:
        x = 1 if dx > 0 else -1

    y = 0
    hit = 0
    close_enough = abs(s['ball']['x'] - s['self']['x']) < 60
    ball_above = s['ball']['y'] < s['self']['y'] - 20

    if s['self']['state'] == 0 and close_enough and ball_above and s['ball']['yVelocity'] > 0:
        y = -1  # jump to meet the ball
    if s['self']['state'] == 1 and close_enough:
        hit = 1
        # xDirection's sign does NOT steer which way the ball goes -- the
        # engine decides that from which side of the net the ball is on.
        # See exampleBots.js CHASE_BOT_SOURCE for the full comment.
        distance_to_net = abs(s['self']['x'] - NET_X)
        if distance_to_net < 80:
            y = 1  # close to the net -- steep smash is safe
        else:
            y = -1  # still far -- arc it over instead of driving into own court
        toward_net = -1 if s['side'] == 'RIGHT' else 1
        x = toward_net

    if tick_counter % LOG_EVERY_N_TICKS == 0:
        print(
            f"[bot {s['side']}] tick={s['tick']} state={s['self']['state']}"
            f" self=({s['self']['x']},{s['self']['y']})"
            f" ball=({s['ball']['x']},{s['ball']['y']})"
            f" landingX={s['ball']['expectedLandingPointX']}"
            f" -> x={x} y={y} hit={hit}"
        )

    return {'x': x, 'y': y, 'hit': hit}
`;
