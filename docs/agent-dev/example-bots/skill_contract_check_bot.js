/**
 * Example bot: "contract checker" -- verifies the snapshot API at runtime.
 *
 * Every tick it validates that every field documented in
 * docs/agent-dev/CONTRACTS.md §1.2 / §1.2.1 is actually present, of the right
 * type, and inside its documented range. Any violation is reported once with
 * console.error (so it cannot scroll away in a flood), and a summary line is
 * printed every ~3 seconds.
 *
 * While checking, it also plays: it dodges a claw aimed at it and casts one of
 * its own whenever it can afford it, so the skill fields are actually
 * exercised rather than just read.
 *
 * How to use: paste into the LEFT and/or RIGHT textarea of the Bot Setup
 * panel, press Apply, and watch the browser console. Bot logs come from the
 * bot's own Worker -- Chrome usually mirrors them into the main console; if
 * not, pick the Worker context in DevTools (Sources -> top-left context
 * selector, or chrome://inspect -> Workers).
 *
 * Works on either side (reads s.side itself).
 *
 * Protocol reference: docs/agent-dev/CONTRACTS.md v0.7
 */
'use strict';

var PLAYER_HALF_LENGTH = 32; // half a player's hitbox width
var NET_X = 216; // GROUND_HALF_WIDTH
var GROUND_WIDTH = 432;
var LOG_EVERY_N_TICKS = 25; // ~3s at 3 frames/tick

// Persistent across ticks: the whole source runs once, and decide() closes
// over these (see botWorker.js).
var stats = {
  ticks: 0,
  errors: 0,
  casts: 0,
  strikesAgainstMe: 0,
  stunnedAtStrike: 0,
  dodgedAtStrike: 0,
  ticksStunned: 0,
  minGauge: 999,
  maxGauge: -1,
  sawIncomingClaw: 0,
  sawOwnClaw: 0,
};
var reported = {}; // message -> true, so each distinct failure prints once
var previous = null; // previous tick's snapshot, for transition checks

function fail(message) {
  stats.errors++;
  if (!reported[message]) {
    reported[message] = true;
    console.error('[CONTRACT FAIL] ' + message);
  }
}

function isInt(v) {
  return typeof v === 'number' && isFinite(v) && Math.floor(v) === v;
}

function checkNumber(path, v, min, max) {
  if (typeof v !== 'number' || !isFinite(v)) {
    fail(path + ' is not a finite number: ' + JSON.stringify(v));
    return;
  }
  if (min !== null && v < min) fail(path + ' below ' + min + ': ' + v);
  if (max !== null && v > max) fail(path + ' above ' + max + ': ' + v);
}

function checkPlayer(path, p, config) {
  if (!p) {
    fail(path + ' missing');
    return;
  }
  checkNumber(path + '.x', p.x, 0, GROUND_WIDTH);
  checkNumber(path + '.y', p.y, null, null);
  if (!isInt(p.state) || p.state < 0 || p.state > 6) {
    fail(path + '.state not 0..6: ' + JSON.stringify(p.state));
  }
  checkNumber(path + '.frameNumber', p.frameNumber, null, null);
  if (p.divingDirection !== -1 && p.divingDirection !== 0 && p.divingDirection !== 1) {
    fail(path + '.divingDirection not -1/0/1: ' + JSON.stringify(p.divingDirection));
  }
  // v0.7 fields
  if (!('lyingDownDurationLeft' in p)) fail(path + '.lyingDownDurationLeft missing');
  else checkNumber(path + '.lyingDownDurationLeft', p.lyingDownDurationLeft, null, null);

  if (!('gauge' in p)) fail(path + '.gauge missing');
  else if (p.gauge === null) fail(path + '.gauge is null -- skill layer not wired?');
  else checkNumber(path + '.gauge', p.gauge, config.gauge.min, config.gauge.max);

  if (!('claw' in p)) fail(path + '.claw missing');
  else if (p.claw !== null) {
    checkNumber(path + '.claw.centerX', p.claw.centerX, 0, GROUND_WIDTH);
    checkNumber(path + '.claw.framesUntilStrike', p.claw.framesUntilStrike, 0, config.claw.warningFrames);
    checkNumber(path + '.claw.framesLeftActive', p.claw.framesLeftActive, 0, config.claw.activeFrames);
    if (p.claw.framesUntilStrike > 0 && p.claw.framesLeftActive > 0) {
      fail(path + '.claw is both telegraphing and active at once');
    }
  }
}

function checkConfig(c) {
  if (!c) {
    fail('config missing');
    return false;
  }
  checkNumber('config.tickFrameGroupSize', c.tickFrameGroupSize, 1, null);
  if (!c.gauge) {
    fail('config.gauge missing/null -- skill layer not wired?');
    return false;
  }
  if (!c.claw) {
    fail('config.claw missing/null -- skill layer not wired?');
    return false;
  }
  checkNumber('config.gauge.min', c.gauge.min, null, null);
  checkNumber('config.gauge.max', c.gauge.max, c.gauge.min + 1, null);
  checkNumber('config.gauge.onReceive', c.gauge.onReceive, null, null);
  checkNumber('config.gauge.onExtraTouch', c.gauge.onExtraTouch, null, null);
  checkNumber('config.gauge.onServe', c.gauge.onServe, null, null);
  checkNumber('config.claw.cost', c.claw.cost, 0, c.gauge.max);
  checkNumber('config.claw.width', c.claw.width, 1, GROUND_WIDTH);
  checkNumber('config.claw.warningFrames', c.claw.warningFrames, 1, null);
  checkNumber('config.claw.stunFrames', c.claw.stunFrames, 1, null);
  checkNumber('config.claw.activeFrames', c.claw.activeFrames, 1, null);
  return true;
}

function checkSnapshot(s) {
  checkNumber('tick', s.tick, 0, null);
  if (s.side !== 'LEFT' && s.side !== 'RIGHT') {
    fail('side not LEFT/RIGHT: ' + JSON.stringify(s.side));
  }
  if (!checkConfig(s.config)) {
    return false; // without config the per-field ranges can't be checked
  }
  checkPlayer('self', s.self, s.config);
  checkPlayer('opp', s.opp, s.config);

  if (!s.ball) fail('ball missing');
  else {
    checkNumber('ball.x', s.ball.x, null, null);
    checkNumber('ball.y', s.ball.y, null, null);
    checkNumber('ball.xVelocity', s.ball.xVelocity, null, null);
    checkNumber('ball.yVelocity', s.ball.yVelocity, null, null);
    checkNumber('ball.expectedLandingPointX', s.ball.expectedLandingPointX, null, null);
    if (typeof s.ball.isPowerHit !== 'boolean') {
      fail('ball.isPowerHit not boolean: ' + JSON.stringify(s.ball.isPowerHit));
    }
  }

  if (!s.meta) fail('meta missing');
  else {
    checkNumber('meta.score.self', s.meta.score.self, 0, null);
    checkNumber('meta.score.opp', s.meta.score.opp, 0, null);
    if (typeof s.meta.isPlayer2Serve !== 'boolean') {
      fail('meta.isPlayer2Serve not boolean: ' + JSON.stringify(s.meta.isPlayer2Serve));
    }
    checkNumber('meta.rallyFrameCount', s.meta.rallyFrameCount, 0, null);
  }
  return true;
}

// Cross-tick checks: the parts that only a sequence of snapshots can reveal.
function checkTransitions(s) {
  if (previous === null || !previous.config.claw) return;

  // A claw that was telegraphing must be counting DOWN, not drifting.
  var before = previous.opp.claw;
  var now = s.opp.claw;
  if (before && now && before.framesUntilStrike > 0 && now.framesUntilStrike > 0) {
    if (now.framesUntilStrike >= before.framesUntilStrike) {
      fail('opp.claw.framesUntilStrike did not decrease: ' +
        before.framesUntilStrike + ' -> ' + now.framesUntilStrike);
    }
    if (now.centerX !== before.centerX) {
      fail('opp.claw.centerX moved mid-telegraph: ' +
        before.centerX + ' -> ' + now.centerX);
    }
  }

  // The documented hit rule, checked against reality: if a claw aimed at us
  // struck while we were inside its range, we must be stunned (state 4).
  //
  // We only sample every tickFrameGroupSize frames, so we can miss the exact
  // strike frame and see the victim after they've already run a few pixels.
  // MARGIN covers that (6px per frame is the engine's player speed) -- without
  // it this check would cry wolf on every near-miss.
  if (before && before.framesUntilStrike > 0 && now && now.framesUntilStrike === 0) {
    stats.strikesAgainstMe++;
    var danger = s.config.claw.width / 2 + PLAYER_HALF_LENGTH;
    var margin = 6 * s.config.tickFrameGroupSize * 2;
    var nearestX = Math.min(
      Math.abs(previous.self.x - before.centerX),
      Math.abs(s.self.x - now.centerX)
    );
    if (s.self.state === 4) {
      stats.stunnedAtStrike++;
      if (nearestX > danger + margin) {
        fail('stunned by a claw we were never near: selfX=' + s.self.x +
          ' centerX=' + now.centerX + ' danger=' + danger);
      }
    } else {
      stats.dodgedAtStrike++;
      var farthestX = Math.max(
        Math.abs(previous.self.x - before.centerX),
        Math.abs(s.self.x - now.centerX)
      );
      if (farthestX + margin < danger) {
        fail('well inside the claw at strike but not stunned: selfX=' + s.self.x +
          ' centerX=' + now.centerX + ' danger=' + danger);
      }
    }
  }

  // Gauge must never move by more than the documented steps in one tick,
  // apart from paying for casts. Skipped across rally/match boundaries, where
  // the tracker legitimately resets it (D-020: reset on a new match).
  var rallyContinued =
    s.meta.score.self === previous.meta.score.self &&
    s.meta.score.opp === previous.meta.score.opp &&
    s.meta.rallyFrameCount > previous.meta.rallyFrameCount;
  if (rallyContinued) {
    var delta = s.self.gauge - previous.self.gauge;
    var biggestStep = Math.max(
      Math.abs(s.config.gauge.onReceive),
      Math.abs(s.config.gauge.onExtraTouch)
    );
    // One tick spans several frames, so a touch and a cast can land together.
    if (delta < -(s.config.claw.cost + biggestStep)) {
      fail('gauge dropped by an undocumented amount: ' + delta);
    }
    if (delta > biggestStep) {
      fail('gauge rose by an undocumented amount: ' + delta);
    }
  }
}

// ---------------------------------------------------------------------------
// Playing: dodge what is aimed at us, cast when we can afford it.
// ---------------------------------------------------------------------------
function dodgeDirection(s) {
  var incoming = s.opp.claw;
  if (!incoming || incoming.framesUntilStrike <= 0) return 0;
  var danger = s.config.claw.width / 2 + PLAYER_HALF_LENGTH;
  var offset = s.self.x - incoming.centerX;
  if (Math.abs(offset) > danger + 6) return 0;
  if (offset === 0) return s.side === 'LEFT' ? -1 : 1;
  return offset > 0 ? 1 : -1;
}

function chooseSkillX(s) {
  if (s.self.claw !== null) return null;
  if (s.self.gauge < s.config.claw.cost) return null;
  var landing = s.ball.expectedLandingPointX;
  var landingIsOnOppHalf = s.side === 'LEFT' ? landing > NET_X : landing < NET_X;
  return landingIsOnOppHalf ? landing : s.opp.x;
}

function decide(s) {
  stats.ticks++;

  if (!checkSnapshot(s)) {
    return { x: 0, y: 0, hit: 0 }; // nothing trustworthy to act on
  }
  checkTransitions(s);

  if (s.self.gauge < stats.minGauge) stats.minGauge = s.self.gauge;
  if (s.self.gauge > stats.maxGauge) stats.maxGauge = s.self.gauge;
  if (s.opp.claw !== null) stats.sawIncomingClaw++;
  if (s.self.claw !== null) stats.sawOwnClaw++;
  if (s.self.state === 4) stats.ticksStunned++;

  // Chase the ball.
  var dx = s.ball.expectedLandingPointX - s.self.x;
  var x = Math.abs(dx) > 8 ? (dx > 0 ? 1 : -1) : 0;
  var y = 0;
  var hit = 0;
  var closeEnough = Math.abs(s.ball.x - s.self.x) < 60;
  var ballAbove = s.ball.y < s.self.y - 20;
  if (s.self.state === 0 && closeEnough && ballAbove && s.ball.yVelocity > 0) {
    y = -1;
  }
  if (s.self.state === 1 && closeEnough) {
    hit = 1;
    y = Math.abs(s.self.x - NET_X) < 80 ? 1 : -1;
    x = s.side === 'RIGHT' ? -1 : 1;
  }

  // Dodging beats positioning: a stun costs a full second of doing nothing.
  var dodge = dodgeDirection(s);
  if (dodge !== 0) x = dodge;

  var skillX = chooseSkillX(s);
  if (skillX !== null) stats.casts++;

  if (stats.ticks % LOG_EVERY_N_TICKS === 0) {
    console.log(
      '[' + s.side + ' check] tick=' + s.tick +
      ' | ERRORS=' + stats.errors +
      ' | gauge=' + s.self.gauge + '(seen ' + stats.minGauge + '~' + stats.maxGauge + ')' +
      ' opp=' + s.opp.gauge +
      ' | castsRequested=' + stats.casts +
      ' ownClawTicks=' + stats.sawOwnClaw +
      ' incomingClawTicks=' + stats.sawIncomingClaw +
      ' | strikesAtMe=' + stats.strikesAgainstMe +
      ' (stunned ' + stats.stunnedAtStrike + ' / dodged ' + stats.dodgedAtStrike + ')' +
      ' stunTicks=' + stats.ticksStunned +
      ' | cfg cost=' + s.config.claw.cost +
      ' width=' + s.config.claw.width +
      ' warn=' + s.config.claw.warningFrames +
      ' stun=' + s.config.claw.stunFrames
    );
  }

  previous = s;
  return { x: x, y: y, hit: hit, skillX: skillX };
}
