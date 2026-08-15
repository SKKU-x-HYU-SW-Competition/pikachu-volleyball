/**
 * Example bot: claw aimed at the ball's predicted LANDING POINT.
 *
 * Paired with claw_opponent_position_bot.js as a controlled experiment. The
 * two files are byte-identical except for aimX() at the bottom -- same
 * positioning, same jumping, same smashing, same dodging, same cast timing.
 * The only variable is *where* the claw is aimed, so whatever the win rate
 * says is about aiming and nothing else. If you edit the shared section,
 * edit it in both files or the comparison stops meaning anything.
 *
 * This one leads the target. A claw takes config.claw.warningFrames to land
 * (25 frames = 1.00s), so aiming at where the opponent stands right now aims
 * a full second behind them. Instead this bot asks where the ball is going
 * to come down on their half, and puts the claw there -- because that is the
 * one spot the opponent has to occupy to keep the rally alive. It also waits
 * for the moment when the ball's remaining flight time matches the claw's
 * telegraph, so the strike and their arrival coincide.
 *
 * Works on either side (reads s.side itself) -- pick it for LEFT or RIGHT
 * from the dropdown in the Bot Setup panel (ADR-0028).
 *
 * Protocol reference: docs/agent-dev/CONTRACTS.md (§1.1 skillX, §1.2.1 claw)
 */
'use strict';

// ===========================================================================
// SHARED -- keep identical to claw_opponent_position_bot.js
// ===========================================================================

// Engine coordinates (CONTRACTS.md §1.2). y grows downward.
var NET_X = 216; // GROUND_HALF_WIDTH
var GROUND_WIDTH = 432;
var PLAYER_HALF_LENGTH = 32;
var PLAYER_LENGTH = 64;
var BALL_TOUCHING_GROUND_Y_COORD = 252;
var BALL_RADIUS = 20;
var NET_PILLAR_HALF_WIDTH = 25;
var NET_PILLAR_TOP_TOP_Y_COORD = 176;
var PLAYER_SPEED_PER_FRAME = 6; // physics.js:519, xDirection * 6

// The built-in AI's thresholds are all written in terms of computerBoldness,
// which is rand() % 5 per player (physics.js:213) -- so the engine itself
// plays with a different number every match. The middle of that range is used
// here wherever a threshold is borrowed from it.
var BOLDNESS = 2;

// How far off the ideal cast moment we still accept, in frames. One tick is
// tickFrameGroupSize (3) frames, so anything under 3 would make the window
// possible to step straight over.
var CAST_WINDOW_FRAMES = 5;

/**
 * Frames until the ball reaches the ground, by replaying the engine's own
 * vertical integration (physics.js calculateExpectedLandingPointXFor: add
 * velocity, test the ground, then add 1 to velocity).
 *
 * Only the vertical axis is replayed, so a ball that bounces off the top of
 * the net on its way down comes back a few frames early. That is rare and it
 * only ever makes us cast slightly late, never wildly wrong.
 */
function framesUntilBallLands(s) {
  var y = s.ball.y;
  var vy = s.ball.yVelocity;
  for (var n = 1; n <= 120; n++) {
    y += vy;
    if (y > BALL_TOUCHING_GROUND_Y_COORD) {
      return n;
    }
    vy += 1;
  }
  return 120; // ball is going up hard; nowhere near landing
}

/**
 * Where a power hit would land, given the two direction inputs. Port of the
 * engine's expectedLandingPointXWhenPowerHit() -- same arithmetic, same net
 * handling, same wall bounce.
 *
 * The two inputs do very different things, and neither of them steers the
 * ball left or right:
 *   - xDirection only sets speed: |x| + 1, times 10. The *sign* of the ball's
 *     new xVelocity comes from which side of the net the ball is on.
 *   - yDirection multiplies the current vertical speed by 2 and picks the
 *     sign, so -1 lobs it up, 1 drives it down, 0 flattens it.
 * That is why guessing an angle from "am I near the net" does not work, and
 * why the engine's own AI simulates instead.
 */
function powerHitLandingX(xDirection, yDirection, ball) {
  var x = ball.x;
  var y = ball.y;
  var vx =
    x < NET_X
      ? (Math.abs(xDirection) + 1) * 10
      : -(Math.abs(xDirection) + 1) * 10;
  var vy = Math.abs(ball.yVelocity) * yDirection * 2;

  for (var i = 0; i < 1000; i++) {
    if (x + vx < BALL_RADIUS || x + vx > GROUND_WIDTH) vx = -vx;
    if (y + vy < 0) vy = 1;
    // The engine flips vy for the whole net column, not just its top edge.
    // That is a known quirk (it is what makes the built-in AI occasionally
    // spike into the net); mirrored here so our prediction matches reality.
    if (Math.abs(x - NET_X) < NET_PILLAR_HALF_WIDTH && y > NET_PILLAR_TOP_TOP_Y_COORD) {
      if (vy > 0) vy = -vy;
    }
    y = y + vy;
    if (y > BALL_TOUCHING_GROUND_Y_COORD) return x;
    x = x + vx;
    vy += 1;
  }
  return x;
}

/**
 * Pick a power hit that puts the ball down in their court, or null if no
 * direction combination does.
 *
 * Mirrors decideWhetherInputPowerHit (physics.js:905-951) but with one
 * deliberate change, and it is the difference between a bot that scores and
 * one that does not: the engine's AI gives up unless the landing point is
 * also PLAYER_LENGTH away from the opponent, and simply declines to swing
 * otherwise. In the original game declining is free -- you may bump the ball
 * to yourself forever. This build added a five-touch cap
 * (rules/touchLimit.js, MAX_TOUCHES_PER_SIDE), so declining now runs out the
 * count and hands over the point. Getting it across near the opponent beats
 * not getting it across at all, so an unplaced smash is used as a fallback
 * rather than treated as a failure.
 */
function chooseSmash(s, forcedXd) {
  var p2 = s.side === 'RIGHT' ? 1 : 0;
  var fallback = null;
  // Same search order as the engine's AI: fastest first, lob before drive.
  // forcedXd pins the speed when we already know which xDirection we are
  // going to send, so the landing point we validate is the one we will get.
  var xds = forcedXd === null ? [1, 0] : [forcedXd];
  for (var i = 0; i < xds.length; i++) {
    var xd = xds[i];
    for (var yd = -1; yd <= 1; yd++) {
      var lp = powerHitLandingX(xd, yd, s.ball);
      // "Their half" spelled exactly as the engine spells it.
      var landsOnTheirHalf = lp <= p2 * NET_X || lp >= p2 * GROUND_WIDTH + NET_X;
      if (!landsOnTheirHalf) continue;
      if (Math.abs(lp - s.opp.x) > PLAYER_LENGTH) {
        return { x: xd, y: yd }; // clears the net AND lands away from them
      }
      if (fallback === null) {
        fallback = { x: xd, y: yd }; // clears the net, but right at them
      }
    }
  }
  return fallback;
}

/** Is the skill layer actually wired? Snapshots stub these to null if not. */
function skillsAvailable(s) {
  return !!(s.config && s.config.claw && s.config.gauge);
}

/**
 * Which way to run from an incoming claw, or 0 to stay on task.
 *
 * opp.claw is the claw *they* cast, i.e. the one aimed at us (§1.2.1). The
 * hit test is x-only -- jumping does not help, running does.
 */
function dodgeDirection(s) {
  if (!skillsAvailable(s)) return 0;
  var incoming = s.opp.claw;
  if (!incoming || incoming.framesUntilStrike <= 0) return 0;

  var danger = s.config.claw.width / 2 + PLAYER_HALF_LENGTH;
  var offset = s.self.x - incoming.centerX;
  var needToTravel = danger + 6 - Math.abs(offset);
  if (needToTravel <= 0) return 0; // already outside the column

  // Don't abandon the ball for a dodge we cannot finish. The snapshot's
  // countdown is up to ~6 frames optimistic (§1.2.1), so budget for that
  // before deciding it is worth trying.
  var framesWeGet = incoming.framesUntilStrike - 6;
  if (framesWeGet * PLAYER_SPEED_PER_FRAME < needToTravel) return 0;

  if (offset !== 0) return offset > 0 ? 1 : -1;

  // Dead centre: break the tie toward whichever side of our own half has
  // more room to run into.
  var ownNear = s.side === 'RIGHT' ? NET_X : 0;
  var ownFar = s.side === 'RIGHT' ? GROUND_WIDTH : NET_X;
  return incoming.centerX - ownNear > ownFar - incoming.centerX ? -1 : 1;
}

/**
 * Ordinary volleyball: stand where the ball is coming down, jump into it,
 * smash it back. No skill involvement at all.
 *
 * The thresholds here are the built-in AI's, not invented ones
 * (physics.js letComputerDecideUserInput, 803-893). That matters most for
 * jumping: the obvious condition -- "ball is above me and coming down" -- is
 * true for almost the whole rally, so a bot using it leaves the ground early,
 * comes back down before the ball arrives, and never gets a clean spike. The
 * engine's own AI instead requires the ball to be genuinely high AND inside
 * the 32px hitbox before it commits.
 */
function basePlay(s) {
  var ownNear = s.side === 'RIGHT' ? NET_X : 0;
  var ownFar = s.side === 'RIGHT' ? GROUND_WIDTH : NET_X;
  var standbyX = (ownNear + ownFar) / 2;

  var landing = s.ball.expectedLandingPointX;
  var landingOnOwnSide = landing > ownNear && landing < ownFar;

  // Retreat to the middle only under the same conditions the engine's AI
  // does (physics.js:809-825): the ball is far away, not travelling fast, and
  // not coming down on our half. Retreating any more eagerly than that throws
  // away ground we would rather already be standing on.
  var ballIsFarAndSlow =
    Math.abs(s.ball.x - s.self.x) > 100 &&
    Math.abs(s.ball.xVelocity) < BOLDNESS + 5;
  var targetX = !landingOnOwnSide && ballIsFarAndSlow ? standbyX : landing;

  var dx = targetX - s.self.x;
  var x = Math.abs(dx) > BOLDNESS + 8 ? (dx > 0 ? 1 : -1) : 0;

  var y = 0;
  var hit = 0;

  if (s.self.state === 0) {
    // Jump (physics.js:840-848). Every clause earns its place: a ball moving
    // sideways fast will cross us before the jump lines up; the 32px window
    // is the engine's actual hitbox, not "close-ish"; and ball.y below ~124
    // is what makes this a jump toward a high ball instead of a hop under a
    // ball that is already at head height.
    var jumpable =
      Math.abs(s.ball.xVelocity) < BOLDNESS + 3 &&
      Math.abs(s.ball.x - s.self.x) < PLAYER_HALF_LENGTH &&
      s.ball.y > -36 &&
      s.ball.y < 10 * BOLDNESS + 84 &&
      s.ball.yVelocity > 0;
    if (jumpable) {
      y = -1;
    } else if (
      // Dive (physics.js:849-864) -- the reach we otherwise do not have. A
      // ball landing on our half, too far to walk to, and already low is
      // exactly the one a standing bot lets bounce.
      landingOnOwnSide &&
      Math.abs(s.ball.x - s.self.x) > BOLDNESS * 5 + PLAYER_LENGTH &&
      s.ball.x > ownNear &&
      s.ball.x < ownFar &&
      s.ball.y > 174
    ) {
      hit = 1; // hit on the ground with a direction = dive
      x = s.ball.x > s.self.x ? 1 : -1;
    }
  } else if (s.self.state === 1 || s.self.state === 2) {
    // Airborne. Steer onto the ball (physics.js:869-876); any nonzero
    // xDirection also gives a power hit its top speed ((|x|+1)*10), so
    // steering and hitting never fight each other.
    var steer = 0;
    if (Math.abs(s.ball.x - s.self.x) > 8) {
      steer = s.ball.x > s.self.x ? 1 : -1;
    }

    // Hold the swing for the whole jump rather than waiting for the ball to
    // be within reach. Two engine facts make waiting the wrong move:
    //   1. powerHit only becomes a smash on the frame the ball actually
    //      collides -- processCollisionBetweenBallAndPlayer decides that from
    //      playerState === 2, not from when the key went down. Swinging at
    //      empty air costs nothing.
    //   2. state 2 falls back to state 1 after ~10 frames (physics.js:608-615)
    //      and a held input re-enters it immediately, so holding simply keeps
    //      us in smash state for the whole jump.
    // Waiting, by contrast, means missing: the reach window is 48px, the ball
    // crosses that in about one tick, and our snapshot is already a tick old.
    // Measured before this change: 267 airborne frames, only 42 of them with
    // the ball in reach -- so the old gate threw away most of every jump.
    var smash = chooseSmash(s, steer !== 0 ? 1 : null);
    if (smash !== null) {
      hit = 1;
      y = smash.y;
      // Opponent right on top of us: lift it instead of driving it flat
      // into them (physics.js:885-891).
      if (Math.abs(s.opp.x - s.self.x) < 80 && y !== -1) {
        y = -1;
      }
      x = steer !== 0 ? steer : smash.x;
    } else {
      x = steer;
    }
  }
  return { x: x, y: y, hit: hit };
}

/**
 * Should we spend a cast this tick? Identical in both bots -- only aimX()
 * differs, so timing never confounds the comparison.
 *
 * The window is built around the claw's telegraph: cast so that the strike
 * lands when the ball does, which is when the opponent has to be standing
 * under it. Add one tick of pipeline lag (§1.2.1) since our snapshot is
 * already that old by the time the cast is read.
 */
function readyToCast(s) {
  if (!skillsAvailable(s)) return false;
  if (s.self.claw !== null) return false; // already telegraphing; would be refused
  if (s.self.gauge < s.config.claw.cost) return false;
  if (s.self.state === 4) return false; // stunned casts are refused

  var landing = s.ball.expectedLandingPointX;
  var landsOnOppSide = s.side === 'LEFT' ? landing > NET_X : landing < NET_X;
  if (!landsOnOppSide) return false;

  var lead = s.config.claw.warningFrames + s.config.tickFrameGroupSize;
  if (Math.abs(framesUntilBallLands(s) - lead) <= CAST_WINDOW_FRAMES) {
    return true;
  }

  // The gauge is capped, so a full one earns nothing by waiting for a
  // prettier moment. Spend it rather than let the charge go to waste.
  if (s.self.gauge >= s.config.gauge.max) return true;

  return false;
}

function decide(s) {
  // Stunned: the engine ignores our input anyway, and holding a cast until
  // we can act again is better than throwing it away.
  if (s.self.state === 4) {
    return { x: 0, y: 0, hit: 0 };
  }

  var action = basePlay(s);

  // Dodging outranks positioning: a stun costs a full second of standing
  // still, which loses the rally far more reliably than one bad receive.
  var dodge = dodgeDirection(s);
  if (dodge !== 0) {
    action.x = dodge;
  }

  return {
    x: action.x,
    y: action.y,
    hit: action.hit,
    skillX: readyToCast(s) ? aimX(s) : null,
  };
}

// ===========================================================================
// THE ONLY DIFFERENCE -- aiming rule
// ===========================================================================

/**
 * Aim where the ball will come down on their half.
 *
 * expectedLandingPointX is the engine's own forward simulation, net and wall
 * bounces included (physics.js:787), exposed on purpose so bots don't have
 * to re-derive it (D-006). Because readyToCast() only fires when that
 * landing is roughly warningFrames away, this is a genuine lead: we are
 * aiming at where they must be, at the moment they must be there.
 */
function aimX(s) {
  return s.ball.expectedLandingPointX;
}
