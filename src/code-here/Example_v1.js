// Persistent across ticks: this whole source runs once through new Function()
// in botWorker.js, and the returned decide() closes over these -- they are
// NOT reset every call.
var tickCounter = 0;
var LOG_EVERY_N_TICKS = 100;
var NET_X = 216; // GROUND_HALF_WIDTH, see CONTRACTS.md §1.2
var PLAYER_HALF_LENGTH = 32; // half a player's hitbox width

// Which way to run to get out of a claw that is about to land on us, or 0 if
// there is nothing to dodge. CONTRACTS.md §1.2.1: a claw is listed under the
// player who CAST it, so opp.claw is the one aimed at us (and self.claw is
// ours -- while it is non-null we cannot cast again). The claw checks x only,
// so jumping never helps.
function dodgeDirection(s) {
  var incoming = s.opp.claw;
  if (!s.config.claw || !incoming || incoming.framesUntilStrike <= 0) {
    return 0; // no skill layer wired, or nothing incoming, or already struck
  }
  var dangerHalfWidth = s.config.claw.width / 2 + PLAYER_HALF_LENGTH;
  var offset = s.self.x - incoming.centerX;
  if (Math.abs(offset) > dangerHalfWidth + 6) {
    return 0; // already outside the range, stay on the ball instead
  }
  if (offset === 0) {
    // Dead centre -- head for the middle of our own half, which has the most
    // room to keep running.
    return s.side === 'LEFT' ? -1 : 1;
  }
  return offset > 0 ? 1 : -1; // keep going the way we're already leaning
}

// x to aim our own claw at, or null for "don't cast this tick".
function chooseSkillX(s) {
  if (!s.config.claw) {
    return null; // snapshot has no skill info (pre-v0.7 wiring)
  }
  if (s.self.claw !== null) {
    return null; // ours is still in flight -- casting again would be refused
  }
  if (s.self.gauge < s.config.claw.cost) {
    return null; // cannot afford it; the cast would be silently ignored
  }
  // Aim where the opponent has to be, not where they are: if the ball is
  // heading for their half they must go to its landing point.
  var oppHalfIsRight = s.side === 'LEFT';
  var landing = s.ball.expectedLandingPointX;
  var landingIsOnOppHalf = oppHalfIsRight ? landing > NET_X : landing < NET_X;
  return landingIsOnOppHalf ? landing : s.opp.x;
}

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

  // Getting clawed costs a full second of standing still, which loses the
  // rally far more reliably than one badly-positioned return does -- so
  // dodging overrides chasing the ball.
  var dodge = dodgeDirection(s);
  if (dodge !== 0) {
    x = dodge;
  }

  var skillX = chooseSkillX(s);

  if (tickCounter % LOG_EVERY_N_TICKS === 0) {
    console.log(
      '[bot ' + s.side + '] tick=' + s.tick +
      ' state=' + s.self.state +
      ' self=(' + s.self.x + ',' + s.self.y + ')' +
      ' ball=(' + s.ball.x + ',' + s.ball.y + ')' +
      ' landingX=' + s.ball.expectedLandingPointX +
      ' gauge=' + s.self.gauge + '/' + s.opp.gauge +
      ' -> x=' + x + ' y=' + y + ' hit=' + hit + ' skillX=' + skillX
    );
  }

  // skillX: null casts nothing, a number casts a claw centred there.
  return { x: x, y: y, hit: hit, skillX: skillX };
}
