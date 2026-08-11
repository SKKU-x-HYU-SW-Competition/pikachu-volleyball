/**
 * Generated modular power bot.
 * Paste this entire file into Bot Setup as JavaScript.
 * Source modules: 00-core.js, 01-physics-predictor.js, 02-state-and-reachability.js, 03-defense.js, 04-offense.js, 05-serve-machine.js, 06-controller.js
 */
/**
 * Power bot module 00: constants, configuration, shared state and helpers.
 *
 * Participant bot sources cannot import ES modules.  The numbered modules in
 * this directory therefore extend one `PowerBot` namespace and are concatenated
 * into power-bot.js by build-power-bot.cjs.
 */
'use strict';

var PowerBot = (function () {
  var api = {};

  api.C = {
    GROUND_WIDTH: 432,
    NET_X: 216,
    PLAYER_GROUND_Y: 244,
    BALL_GROUND_Y: 252,
    BALL_RADIUS: 20,
    PLAYER_HALF: 32,
    NET_HALF_WIDTH: 25,
    NET_TOP_Y: 176,
    NET_BOTTOM_Y: 192,
    PLAYER_SPEED: 6,
    DIVE_SPEED: 8,
    MAX_PATH_FRAMES: 1000,
    MAX_ATTACK_LOOKAHEAD: 34,
  };

  api.config = {
    defenseMode: 'ADVANCED_FORWARD',
    reactionDelayFrames: 0,
    enablePredictiveDefense: true,
    enableDiving: true,
    enableBlocking: true,
    enableFancyCombos: true,
    enableAntiBlock: true,
    enableServeSkills: true,
    enableRandomVariation: true,
    actionLeadFrames: 1,
    debug: false,
  };

  api.state = {
    lastSnapshot: null,
    lastAction: { x: 0, y: 0, hit: 0 },
    selfYVelocity: 0,
    oppYVelocity: 0,
    cooldownFrames: 0,
    plan: null,
    serve: null,
    airShot: null,
    pendingRoundStart: true,
    roundActive: false,
    rng: 0x5f3759df,
    lastScoreTotal: null,
    lastRallyFrame: null,
  };

  api.clamp = function (value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  };

  api.sign = function (value) {
    return value < 0 ? -1 : value > 0 ? 1 : 0;
  };

  api.towardNet = function (side) {
    return side === 'LEFT' ? 1 : -1;
  };

  api.isOnSide = function (side, x) {
    return side === 'LEFT' ? x < api.C.NET_X : x >= api.C.NET_X;
  };

  api.isReachableOnSide = function (side, x) {
    if (x === api.C.NET_X) return true;
    return api.isOnSide(side, x);
  };

  api.isOnOpponentSide = function (side, x) {
    return !api.isOnSide(side, x);
  };

  api.courtBounds = function (side) {
    return side === 'LEFT' ? { min: 32, max: 184 } : { min: 248, max: 400 };
  };

  api.clampToCourt = function (side, x) {
    var bounds = api.courtBounds(side);
    return api.clamp(x, bounds.min, bounds.max);
  };

  api.moveToward = function (currentX, targetX, deadZone) {
    var zone = deadZone === undefined ? 5 : deadZone;
    if (targetX < currentX - zone) return -1;
    if (targetX > currentX + zone) return 1;
    return 0;
  };

  api.random = function () {
    var x = api.state.rng | 0;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    api.state.rng = x | 0;
    return (x >>> 0) / 4294967296;
  };

  api.choose = function (items) {
    if (items.length === 0) return null;
    return items[Math.floor(api.random() * items.length)];
  };

  api.neutral = function () {
    return { x: 0, y: 0, hit: 0 };
  };

  api.resetRoundState = function (snapshot) {
    api.state.lastSnapshot = null;
    api.state.lastAction = api.neutral();
    api.state.selfYVelocity = 0;
    api.state.oppYVelocity = 0;
    api.state.cooldownFrames = 0;
    api.state.plan = null;
    api.state.serve = null;
    api.state.airShot = null;
    api.state.pendingRoundStart = false;
    api.state.roundActive = false;
    api.state.lastRallyFrame = snapshot.meta.rallyFrameCount;
    api.state.rng =
      (0x5f3759df ^
        snapshot.tick ^
        (snapshot.side === 'LEFT' ? 0x13579bdf : 0x2468ace0)) |
      0;
  };

  api.log = function () {
    if (api.config.debug && typeof console !== 'undefined') {
      console.log.apply(console, arguments);
    }
  };

  return api;
})();

/** Power bot module 01: clean-room copy of the public ball equations. */
(function (PB) {
  var C = PB.C;

  function copyBall(ball) {
    return {
      x: ball.x,
      y: ball.y,
      xVelocity: ball.xVelocity,
      yVelocity: ball.yVelocity,
      isPowerHit: !!ball.isPowerHit,
    };
  }

  function stepBall(ball) {
    var futureX = ball.x + ball.xVelocity;
    if (futureX < C.BALL_RADIUS || futureX > C.GROUND_WIDTH) {
      ball.xVelocity = -ball.xVelocity;
    }

    if (ball.y + ball.yVelocity < 0) {
      ball.yVelocity = 1;
    }

    if (Math.abs(ball.x - C.NET_X) < C.NET_HALF_WIDTH && ball.y > C.NET_TOP_Y) {
      if (ball.y <= C.NET_BOTTOM_Y) {
        if (ball.yVelocity > 0) ball.yVelocity = -ball.yVelocity;
      } else if (ball.x < C.NET_X) {
        ball.xVelocity = -Math.abs(ball.xVelocity);
      } else {
        ball.xVelocity = Math.abs(ball.xVelocity);
      }
    }

    var futureY = ball.y + ball.yVelocity;
    if (futureY > C.BALL_GROUND_Y) {
      ball.y = C.BALL_GROUND_Y;
      return true;
    }

    ball.y = futureY;
    ball.x += ball.xVelocity;
    ball.yVelocity += 1;
    return false;
  }

  function trace(ball, maxFrames) {
    var moving = copyBall(ball);
    var result = [copyBall(moving)];
    var limit = maxFrames || C.MAX_PATH_FRAMES;
    result.landed = false;
    for (var frame = 1; frame <= limit; frame++) {
      var touchedGround = stepBall(moving);
      var point = copyBall(moving);
      point.frame = frame;
      result.push(point);
      if (touchedGround) {
        result.landed = true;
        break;
      }
    }
    return result;
  }

  function applySmash(ball, shot) {
    var smashed = copyBall(ball);
    var verticalSpeed = Math.max(15, Math.abs(smashed.yVelocity));
    smashed.xVelocity =
      (smashed.x < C.NET_X ? 1 : -1) * (shot.strong ? 20 : 10);
    smashed.yVelocity = verticalSpeed * shot.y * 2;
    smashed.isPowerHit = true;
    return smashed;
  }

  var SHOTS = [
    { id: 0, name: 'UP_WEAK', y: -1, strong: false },
    { id: 1, name: 'UP_STRONG', y: -1, strong: true },
    { id: 2, name: 'FLAT_WEAK', y: 0, strong: false },
    { id: 3, name: 'FLAT_STRONG', y: 0, strong: true },
    { id: 4, name: 'DOWN_WEAK', y: 1, strong: false },
    { id: 5, name: 'DOWN_STRONG', y: 1, strong: true },
  ];

  function simulateShot(ball, shot) {
    var path = trace(applySmash(ball, shot));
    return {
      shot: shot,
      path: path,
      landing: path[path.length - 1],
      flightFrames: path.length - 1,
      landed: path.landed,
    };
  }

  function simulateAllShots(ball) {
    return SHOTS.map(function (shot) {
      return simulateShot(ball, shot);
    });
  }

  function advance(ball, frames) {
    var advanced = copyBall(ball);
    for (var i = 0; i < frames; i++) {
      if (stepBall(advanced)) break;
    }
    return advanced;
  }

  PB.physics = {
    copyBall: copyBall,
    stepBall: stepBall,
    trace: trace,
    advance: advance,
    applySmash: applySmash,
    simulateShot: simulateShot,
    simulateAllShots: simulateAllShots,
    shots: SHOTS,
  };
})(PowerBot);

/** Power bot module 02: hidden-state estimation and reachability tests. */
(function (PB) {
  var C = PB.C;

  function inferYVelocity(previous, current, previousVelocity, deltaFrames) {
    if (!previous || current.state === 0 || current.state >= 3) return 0;
    var bestVelocity = previousVelocity;
    var bestError = Infinity;

    for (var candidate = -16; candidate <= 16; candidate++) {
      var y = previous.y;
      var velocity = candidate;
      for (var frame = 0; frame < deltaFrames; frame++) {
        y += velocity;
        if (y < C.PLAYER_GROUND_Y) velocity += 1;
        else {
          y = C.PLAYER_GROUND_Y;
          velocity = 0;
        }
      }
      var error = Math.abs(y - current.y);
      if (error < bestError) {
        bestError = error;
        bestVelocity = velocity;
      }
    }
    return bestVelocity;
  }

  function updateEstimates(snapshot) {
    var previous = PB.state.lastSnapshot;
    if (!previous || snapshot.tick <= previous.tick) {
      PB.state.selfYVelocity = snapshot.self.state === 0 ? 0 : -13;
      PB.state.oppYVelocity = snapshot.opp.state === 0 ? 0 : -13;
      return;
    }
    var delta = snapshot.tick - previous.tick;
    PB.state.selfYVelocity = inferYVelocity(
      previous.self,
      snapshot.self,
      PB.state.selfYVelocity,
      delta
    );
    PB.state.oppYVelocity = inferYVelocity(
      previous.opp,
      snapshot.opp,
      PB.state.oppYVelocity,
      delta
    );
  }

  function playerYAt(player, initialVelocity, frames, jumpWhenGrounded) {
    var y = player.y;
    var velocity = player.state === 0 ? 0 : initialVelocity;
    var jumped = player.state !== 0;

    for (var frame = 0; frame < frames; frame++) {
      if (jumpWhenGrounded && y === C.PLAYER_GROUND_Y && !jumped) {
        velocity = -16;
        jumped = true;
      }
      y += velocity;
      if (y < C.PLAYER_GROUND_Y) velocity += 1;
      else {
        y = C.PLAYER_GROUND_Y;
        velocity = 0;
      }
    }
    return y;
  }

  function playerYLoopAt(player, initialVelocity, frames) {
    var y = player.y;
    var velocity = player.state === 0 ? -16 : initialVelocity;
    for (var frame = 0; frame < frames; frame++) {
      y += velocity;
      velocity += 1;
      if (y >= C.PLAYER_GROUND_Y) {
        y = C.PLAYER_GROUND_Y;
        velocity = -16;
      }
    }
    return y;
  }

  function horizontalReach(playerX, ballX, frames, extra) {
    return (
      Math.abs(ballX - playerX) <=
      C.PLAYER_SPEED * frames + C.PLAYER_HALF + (extra || 0)
    );
  }

  function canTouch(side, player, yVelocity, ball, frames, allowJump) {
    if (ball.y < 76 || !PB.isReachableOnSide(side, ball.x)) return false;
    if (!horizontalReach(player.x, ball.x, frames, 6)) return false;

    var predictedY = playerYAt(player, yVelocity, frames, allowJump);
    if (Math.abs(predictedY - ball.y) <= C.PLAYER_HALF) return true;

    if (allowJump && player.state === 0) {
      var jumpY = playerYAt(player, 0, frames, true);
      return Math.abs(jumpY - ball.y) <= C.PLAYER_HALF;
    }
    return false;
  }

  function firstReachableContact(side, player, yVelocity, path, allowJump) {
    for (var frame = 0; frame < path.length; frame++) {
      if (canTouch(side, player, yVelocity, path[frame], frame, allowJump)) {
        return { frame: frame, ball: path[frame] };
      }
    }
    return null;
  }

  function canBlock(side, opponent, opponentYVelocity, shotResult) {
    var enteredCourt = false;
    for (var frame = 0; frame < shotResult.path.length; frame++) {
      var ball = shotResult.path[frame];
      if (!PB.isReachableOnSide(side, ball.x)) continue;
      if (!enteredCourt) {
        enteredCourt = true;
        if (ball.y > C.NET_BOTTOM_Y) return false;
      }
      if (Math.abs(ball.x - C.NET_X) > 60) return false;
      if (
        Math.abs(
          ball.y - playerYAt(opponent, opponentYVelocity, frame + 1, true)
        ) <= C.PLAYER_HALF
      ) {
        return true;
      }
    }
    return false;
  }

  function canWalkTo(playerX, targetX, frames) {
    return Math.abs(targetX - playerX) <= C.PLAYER_SPEED * frames + 3;
  }

  function canDiveTo(playerX, targetX, frames) {
    return Math.abs(targetX - playerX) <= C.DIVE_SPEED * frames + C.PLAYER_HALF;
  }

  PB.reach = {
    updateEstimates: updateEstimates,
    playerYAt: playerYAt,
    playerYLoopAt: playerYLoopAt,
    canTouch: canTouch,
    firstReachableContact: firstReachableContact,
    canBlock: canBlock,
    canWalkTo: canWalkTo,
    canDiveTo: canDiveTo,
  };
})(PowerBot);

/** Power bot module 03: predictive defense, blocking and emergency diving. */
(function (PB) {
  var C = PB.C;

  function standbyTarget(snapshot) {
    var side = snapshot.side;
    var opponentDistance = Math.abs(snapshot.opp.x - C.NET_X);
    var sign = side === 'LEFT' ? -1 : 1;

    if (PB.config.defenseMode === 'CENTER') {
      return C.NET_X + sign * 108;
    }
    if (PB.config.defenseMode === 'MIRROR_CENTER') {
      return C.NET_X + sign * (54 + opponentDistance / 2);
    }
    if (PB.config.defenseMode === 'MIRROR') {
      return C.NET_X + sign * opponentDistance;
    }
    if (PB.config.defenseMode === 'ADVANCED_FORWARD') {
      return C.NET_X + sign * 44;
    }
    return C.NET_X + sign * 108;
  }

  function predictedOpponentAttack(snapshot, path) {
    if (!PB.config.enablePredictiveDefense) return null;

    var opponentSide = snapshot.side === 'LEFT' ? 'RIGHT' : 'LEFT';
    var threats = [];
    var limit = Math.min(path.length, C.MAX_ATTACK_LOOKAHEAD);

    for (var frame = 0; frame < limit; frame++) {
      if (
        !PB.reach.canTouch(
          opponentSide,
          snapshot.opp,
          PB.state.oppYVelocity,
          path[frame],
          frame,
          true
        )
      ) {
        continue;
      }
      PB.physics.simulateAllShots(path[frame]).forEach(function (result) {
        if (!result.landed) return;
        if (
          (result.shot.id === 4 || result.shot.id === 5) &&
          result.path.length > 3 &&
          result.path[3].yVelocity < 3 &&
          PB.isReachableOnSide(opponentSide, result.path[1].x)
        ) {
          threats.push({
            result: result,
            contactFrame: frame,
            totalFrames: 0,
            targetX: C.NET_X,
            thunder: true,
          });
        } else if (PB.isOnSide(snapshot.side, result.landing.x)) {
          threats.push({
            result: result,
            contactFrame: frame,
            totalFrames: frame + result.flightFrames,
            targetX: result.landing.x,
            thunder: false,
          });
        }
      });
    }
    if (threats.length === 0) return null;

    threats.sort(function (left, right) {
      return left.totalFrames - right.totalFrames;
    });
    var quickest = threats[0].totalFrames;
    var quickestThreats = threats.filter(function (threat) {
      return threat.totalFrames === quickest;
    });
    var target =
      quickestThreats.reduce(function (sum, threat) {
        return sum + threat.targetX;
      }, 0) / quickestThreats.length;

    return {
      targetX: target,
      contactFrame: quickestThreats[0].contactFrame,
      landingFrames: quickest,
      shotId: quickestThreats[0].result.shot.id,
      thunder: quickestThreats[0].thunder,
      threats: threats,
    };
  }

  function defenseTarget(snapshot, path) {
    var prediction = predictedOpponentAttack(snapshot, path);
    if (prediction) {
      PB.state.cooldownFrames = 0;
      if (PB.config.defenseMode === 'PREDICT') {
        return PB.clampToCourt(snapshot.side, prediction.targetX);
      }
      if (PB.config.defenseMode === 'ADVANCED_FORWARD') {
        var advanced = C.NET_X + (snapshot.side === 'LEFT' ? -44 : 44);
        var airborneStraightException =
          snapshot.self.state > 0 &&
          (prediction.shotId === 0 || prediction.shotId === 3) &&
          PB.state.selfYVelocity < 0 &&
          Math.abs(prediction.targetX - C.NET_X) > C.NET_X - C.PLAYER_HALF;
        return PB.clampToCourt(
          snapshot.side,
          airborneStraightException ? prediction.targetX : advanced
        );
      }
      return PB.clampToCourt(snapshot.side, standbyTarget(snapshot));
    }

    PB.state.cooldownFrames += PB.state.lastSnapshot
      ? Math.max(1, snapshot.tick - PB.state.lastSnapshot.tick)
      : snapshot.config.tickFrameGroupSize;
    if (
      PB.state.cooldownFrames > PB.config.reactionDelayFrames &&
      path.landed &&
      PB.isOnSide(snapshot.side, path[path.length - 1].x)
    ) {
      var landing = path[path.length - 1].x;
      if (path.length > 24) {
        landing += (snapshot.side === 'LEFT' ? 1 : -1) * 6 * (path.length - 24);
      }
      return PB.clampToCourt(snapshot.side, landing);
    }
    return PB.clampToCourt(snapshot.side, standbyTarget(snapshot));
  }

  function shouldDive(snapshot, path) {
    if (!PB.config.enableDiving || snapshot.self.state !== 0) return false;
    if (!path.landed) return false;
    var landing = path[path.length - 1];
    var frames = path.length - 1;
    if (
      frames < 4 ||
      frames >= 12 ||
      !PB.isOnSide(snapshot.side, landing.x) ||
      snapshot.ball.x > snapshot.self.x !== landing.x > snapshot.self.x
    ) {
      return false;
    }
    if (PB.reach.canWalkTo(snapshot.self.x, landing.x, frames)) return false;

    var direction = PB.sign(landing.x - snapshot.self.x);
    var playerX = snapshot.self.x;
    var playerY = snapshot.self.y;
    var yVelocity = -5;
    for (var frame = 1; frame < path.length; frame++) {
      playerX += direction * (frame === 1 ? C.PLAYER_SPEED : C.DIVE_SPEED);
      playerX = PB.clampToCourt(snapshot.side, playerX);
      if (frame > 1) {
        playerY += yVelocity;
        yVelocity += 1;
        if (playerY > C.PLAYER_GROUND_Y) playerY = C.PLAYER_GROUND_Y;
      }
      if (
        Math.abs(path[frame].x - playerX) <= C.PLAYER_HALF &&
        Math.abs(path[frame].y - playerY) <= C.PLAYER_HALF
      ) {
        return true;
      }
    }
    return false;
  }

  function blockingAction(snapshot, path) {
    if (!PB.config.enableBlocking || snapshot.self.state >= 3) return null;
    if (
      !snapshot.ball.isPowerHit ||
      !path.landed ||
      !PB.isOnSide(snapshot.side, path[path.length - 1].x) ||
      Math.abs(snapshot.ball.x - C.NET_X) > 105
    ) {
      return null;
    }

    var contact = PB.reach.firstReachableContact(
      snapshot.side,
      snapshot.self,
      PB.state.selfYVelocity,
      path.slice(0, 16),
      true
    );
    if (!contact || Math.abs(contact.ball.x - C.NET_X) > 78) return null;

    var targetX = PB.clampToCourt(snapshot.side, contact.ball.x);
    var x = PB.moveToward(snapshot.self.x, targetX, 4);
    if (snapshot.self.state === 0) return { x: x, y: -1, hit: 0 };
    var applyStart = snapshot.tick + PB.config.actionLeadFrames;
    var applyEnd = applyStart + snapshot.config.tickFrameGroupSize - 1;
    var contactTick = snapshot.tick + contact.frame;
    if (
      (snapshot.self.state === 1 || snapshot.self.state === 2) &&
      contactTick >= applyStart - 1 &&
      contactTick <= applyEnd + 1
    ) {
      PB.state.airShot = PB.physics.shots[0];
      return { x: x, y: -1, hit: 1 };
    }
    if (snapshot.self.state === 2 && PB.state.airShot) {
      return { x: x, y: PB.state.airShot.y, hit: 1 };
    }
    return { x: x, y: 0, hit: 0 };
  }

  PB.defense = {
    standbyTarget: standbyTarget,
    predictedOpponentAttack: predictedOpponentAttack,
    target: defenseTarget,
    shouldDive: shouldDive,
    blockingAction: blockingAction,
  };
})(PowerBot);

/**
 * Power bot module 04: six-shot search, anti-block, planned hits and combos.
 * The original one-frame techniques are widened to survive a 3-frame held input.
 */
(function (PB) {
  var C = PB.C;

  function shotAction(side, shot, movementDirection) {
    var toward = PB.towardNet(side);
    var x = shot.strong ? movementDirection || toward : 0;
    return { x: x, y: shot.y, hit: 1 };
  }

  function validOpponentLanding(snapshot, result) {
    return (
      result.landed && PB.isOnOpponentSide(snapshot.side, result.landing.x)
    );
  }

  function chooseShot(snapshot, ball, preferFarthest) {
    var candidates = PB.physics
      .simulateAllShots(ball)
      .filter(function (result) {
        return validOpponentLanding(snapshot, result);
      });
    if (candidates.length === 0) {
      return PB.physics.simulateShot(ball, PB.physics.shots[1]);
    }

    candidates.forEach(function (candidate) {
      candidate.blocked = PB.reach.canBlock(
        snapshot.side === 'LEFT' ? 'RIGHT' : 'LEFT',
        snapshot.opp,
        PB.state.oppYVelocity,
        candidate
      );
    });

    var allBlocked = false;
    if (PB.config.enableAntiBlock) {
      var unblocked = candidates.filter(function (candidate) {
        return !candidate.blocked;
      });
      if (unblocked.length > 0) candidates = unblocked;
      else allBlocked = true;
    }

    if (preferFarthest) {
      candidates.sort(function (left, right) {
        return (
          Math.abs(snapshot.opp.x - right.landing.x) -
          Math.abs(snapshot.opp.x - left.landing.x)
        );
      });
    } else {
      candidates.sort(function (left, right) {
        var leftScore =
          left.flightFrames +
          (left.blocked ? 100 : 0) -
          Math.abs(snapshot.opp.x - left.landing.x) * 0.04;
        var rightScore =
          right.flightFrames +
          (right.blocked ? 100 : 0) -
          Math.abs(snapshot.opp.x - right.landing.x) * 0.04;
        return leftScore - rightScore;
      });
    }

    var nearBest;
    if (preferFarthest) {
      var farthestDistance = Math.abs(snapshot.opp.x - candidates[0].landing.x);
      nearBest = candidates.filter(function (candidate) {
        return (
          Math.abs(snapshot.opp.x - candidate.landing.x) >= farthestDistance - 3
        );
      });
    } else {
      var bestScoreFrames = candidates[0].flightFrames;
      nearBest = candidates.filter(function (candidate) {
        return candidate.flightFrames <= bestScoreFrames + 2;
      });
    }
    var selected = PB.config.enableRandomVariation
      ? PB.choose(nearBest)
      : candidates[0];
    selected.withhold = allBlocked;
    return selected;
  }

  function findAttackContacts(snapshot, path) {
    var contacts = [];
    var limit = Math.min(path.length, C.MAX_ATTACK_LOOKAHEAD);
    for (var frame = 2; frame < limit; frame++) {
      var controlledFrames = frame - 1;
      if (
        PB.reach.canTouch(
          snapshot.side,
          snapshot.self,
          PB.state.selfYVelocity,
          path[frame],
          controlledFrames,
          true
        )
      ) {
        contacts.push({ frame: frame, ball: path[frame] });
      }
    }
    return contacts;
  }

  function findCombo(snapshot, firstShot, firstContactFrame) {
    if (!PB.config.enableFancyCombos) return null;
    var path = firstShot.path;

    for (var frame = 3; frame < Math.min(path.length - 1, 34); frame++) {
      var ball = path[frame];
      if (!PB.isReachableOnSide(snapshot.side, ball.x)) break;
      var controlledFrames = firstContactFrame - 1 + frame;
      var predictedY = PB.reach.playerYLoopAt(
        snapshot.self,
        PB.state.selfYVelocity,
        controlledFrames
      );
      var previousY = PB.reach.playerYLoopAt(
        snapshot.self,
        PB.state.selfYVelocity,
        controlledFrames - 1
      );
      var separatedOnPreviousFrame =
        Math.abs(path[frame - 1].y - previousY) > C.PLAYER_HALF;
      if (
        separatedOnPreviousFrame &&
        Math.abs(predictedY - ball.y) <= C.PLAYER_HALF &&
        Math.abs(ball.x - snapshot.self.x) <=
          C.PLAYER_SPEED * controlledFrames + C.PLAYER_HALF + 6
      ) {
        var distanceFromNet = Math.abs(ball.x - C.NET_X);
        var kind = firstShot.shot.id === 3 ? 'FLAT' : 'RETURN';
        if (firstShot.shot.id === 2 && distanceFromNet < 42) kind = 'DROP';
        var targetX = ball.x + (snapshot.side === 'LEFT' ? -9 : 9);
        if (distanceFromNet < C.PLAYER_HALF + 8) {
          targetX =
            ball.x +
            (snapshot.side === 'LEFT' ? -C.PLAYER_HALF - 4 : C.PLAYER_HALF + 4);
        }
        targetX = PB.clampToCourt(snapshot.side, targetX);
        if (!PB.reach.canWalkTo(snapshot.self.x, targetX, controlledFrames)) {
          continue;
        }
        return {
          frame: frame,
          controlledFrames: controlledFrames,
          targetX: targetX,
          kind: kind,
          secondJump: controlledFrames > 14,
          juke: firstShot.shot.id === 1 && distanceFromNet < 50,
        };
      }
    }
    return null;
  }

  function createPlan(snapshot, path) {
    if (snapshot.self.state >= 3) return null;

    var contacts = findAttackContacts(snapshot, path);
    for (var contactIndex = 0; contactIndex < contacts.length; contactIndex++) {
      var contact = contacts[contactIndex];
      var allShots = PB.physics.simulateAllShots(contact.ball);
      var comboCandidates = allShots
        .map(function (result) {
          var combo = findCombo(snapshot, result, contact.frame);
          var firstTarget = PB.clampToCourt(
            snapshot.side,
            contact.ball.x +
              PB.towardNet(snapshot.side) * (result.shot.strong ? 17 : 23)
          );
          if (
            combo &&
            !PB.reach.canWalkTo(firstTarget, combo.targetX, combo.frame)
          ) {
            combo = null;
          }
          return { result: result, combo: combo };
        })
        .filter(function (candidate) {
          return candidate.combo !== null;
        });
      comboCandidates.sort(function (left, right) {
        var priority = { FLAT: 0, DROP: 1, RETURN: 2 };
        return (
          priority[left.combo.kind] - priority[right.combo.kind] ||
          left.combo.controlledFrames - right.combo.controlledFrames
        );
      });

      var chosen;
      var combo;
      if (comboCandidates.length > 0) {
        chosen = comboCandidates[0].result;
        combo = comboCandidates[0].combo;
      } else {
        var preferFarthest =
          PB.config.enableRandomVariation && PB.random() < 0.18;
        chosen = chooseShot(snapshot, contact.ball, preferFarthest);
        combo = null;
      }
      var movementOffset = chosen.shot.strong ? 17 : 23;
      var targetX = PB.clampToCourt(
        snapshot.side,
        contact.ball.x + PB.towardNet(snapshot.side) * movementOffset
      );
      if (
        !PB.reach.canWalkTo(
          snapshot.self.x,
          targetX,
          Math.max(1, contact.frame - 1)
        )
      ) {
        continue;
      }

      return {
        phase: 'FIRST',
        createdTick: snapshot.tick,
        contactTick: snapshot.tick + contact.frame - 1,
        targetX: targetX,
        shot: chosen.shot,
        withhold: !!chosen.withhold,
        combo: combo,
        secondTargetX: combo ? combo.targetX : null,
        secondContactTick: combo
          ? snapshot.tick + contact.frame - 1 + combo.frame
          : null,
        didHit: false,
        baseTick: snapshot.tick,
        approachPath: path,
        secondShot: null,
      };
    }
    return null;
  }

  function observedSelfSmash(snapshot, contactTick, armedTick) {
    var previous = PB.state.lastSnapshot;
    if (!previous || snapshot.tick <= previous.tick) return false;
    var elapsed = snapshot.tick - previous.tick;
    var expected = PB.physics.advance(previous.ball, elapsed);
    var discontinuity =
      Math.abs(expected.x - snapshot.ball.x) > 6 ||
      Math.abs(expected.y - snapshot.ball.y) > 8 ||
      Math.abs(expected.xVelocity - snapshot.ball.xVelocity) > 1 ||
      Math.abs(expected.yVelocity - snapshot.ball.yVelocity) > 2;
    return (
      discontinuity &&
      snapshot.self.state === 2 &&
      snapshot.ball.isPowerHit &&
      snapshot.ball.xVelocity * PB.towardNet(snapshot.side) > 0 &&
      snapshot.tick >= contactTick - PB.config.actionLeadFrames * 2 &&
      (armedTick === undefined || snapshot.tick > armedTick)
    );
  }

  function shouldCancelPlan(snapshot, plan) {
    if (!plan || snapshot.self.state >= 3) return true;
    if (snapshot.tick - plan.createdTick > 100) return true;
    if (plan.phase === 'FIRST' && snapshot.tick > plan.contactTick + 12)
      return true;
    if (plan.phase === 'FIRST' && plan.approachPath) {
      var likelyPlannedHit =
        snapshot.self.state === 2 &&
        snapshot.ball.isPowerHit &&
        snapshot.ball.xVelocity * PB.towardNet(snapshot.side) > 0 &&
        snapshot.tick >= plan.contactTick - PB.config.actionLeadFrames * 2;
      var pathIndex = snapshot.tick - plan.baseTick;
      if (
        !likelyPlannedHit &&
        pathIndex >= 0 &&
        pathIndex < plan.approachPath.length
      ) {
        var expected = plan.approachPath[pathIndex];
        if (
          Math.abs(expected.x - snapshot.ball.x) > 8 ||
          Math.abs(expected.y - snapshot.ball.y) > 12 ||
          Math.abs(expected.xVelocity - snapshot.ball.xVelocity) > 1 ||
          Math.abs(expected.yVelocity - snapshot.ball.yVelocity) > 1
        ) {
          return true;
        }
      }
    }
    if (
      plan.phase === 'SECOND' &&
      snapshot.tick > plan.secondContactTick + 15
    ) {
      return true;
    }
    return false;
  }

  function executePlan(snapshot, plan) {
    if (!plan) return null;
    var leadFrames = PB.config.actionLeadFrames;
    var applyStart = snapshot.tick + leadFrames;
    var applyEnd = applyStart + snapshot.config.tickFrameGroupSize - 1;

    if (plan.phase === 'FIRST') {
      if (observedSelfSmash(snapshot, plan.contactTick)) {
        plan.didHit = true;
        if (plan.combo) {
          plan.phase = 'SECOND';
          plan.secondArmedTick = snapshot.tick;
        } else {
          PB.state.plan = null;
          PB.state.airShot = null;
          return shotAction(snapshot.side, plan.shot, 0);
        }
      }

      var firstTarget = PB.clampToCourt(snapshot.side, plan.targetX);
      var firstX = PB.moveToward(snapshot.self.x, firstTarget, 4);
      var untilFirst = plan.contactTick - snapshot.tick;
      var hitWindow =
        plan.contactTick >= applyStart - 1 && plan.contactTick <= applyEnd + 1;

      if (snapshot.self.state === 0) {
        if (hitWindow && !plan.withhold) {
          // Ground jump + hit are processed in one engine frame, enabling the
          // classic zero-second up-smash when the ball is already entering the
          // collision window.
          var zeroSecondShot = PB.physics.shots[plan.shot.strong ? 1 : 0];
          PB.state.airShot = zeroSecondShot;
          return shotAction(
            snapshot.side,
            zeroSecondShot,
            firstX || PB.towardNet(snapshot.side)
          );
        }
        // Reachability was evaluated assuming an immediate jump.
        var shouldJump = untilFirst > -leadFrames;
        return { x: firstX, y: shouldJump ? -1 : 0, hit: 0 };
      }
      if (
        (snapshot.self.state === 1 || snapshot.self.state === 2) &&
        (hitWindow ||
          (snapshot.self.state === 2 &&
            snapshot.tick <=
              plan.contactTick + snapshot.config.tickFrameGroupSize))
      ) {
        if (plan.withhold && snapshot.self.state === 1) {
          return { x: firstX, y: 0, hit: 0 };
        }
        PB.state.airShot = plan.shot;
        return shotAction(
          snapshot.side,
          plan.shot,
          firstX || PB.towardNet(snapshot.side)
        );
      }
      return { x: firstX, y: 0, hit: 0 };
    }

    if (plan.phase === 'SECOND') {
      if (
        observedSelfSmash(
          snapshot,
          plan.secondContactTick,
          plan.secondArmedTick
        )
      ) {
        var completedShot = plan.secondShot || plan.shot;
        PB.state.plan = null;
        PB.state.airShot = null;
        return shotAction(snapshot.side, completedShot, 0);
      }
      var secondX = PB.moveToward(snapshot.self.x, plan.secondTargetX, 4);
      var untilSecond = plan.secondContactTick - snapshot.tick;
      if (
        plan.combo.secondJump &&
        snapshot.self.state === 0 &&
        untilSecond > -leadFrames
      ) {
        return { x: secondX, y: -1, hit: 0 };
      }

      var secondHitWindow =
        plan.secondContactTick >= applyStart - 1 &&
        plan.secondContactTick <= applyEnd + 1;
      if (
        (snapshot.self.state === 1 || snapshot.self.state === 2) &&
        (secondHitWindow ||
          (snapshot.self.state === 2 &&
            snapshot.tick <=
              plan.secondContactTick + snapshot.config.tickFrameGroupSize))
      ) {
        if (!plan.secondShot) {
          plan.secondShot = chooseShot(
            snapshot,
            snapshot.ball,
            PB.config.enableRandomVariation && PB.random() < 0.2
          ).shot;
        }
        var direction = secondX || PB.towardNet(snapshot.side);
        if (plan.combo.juke && PB.random() < 0.5) direction = -direction;
        PB.state.airShot = plan.secondShot;
        return shotAction(snapshot.side, plan.secondShot, direction);
      }
      return { x: secondX, y: 0, hit: 0 };
    }
    return null;
  }

  PB.offense = {
    shotAction: shotAction,
    chooseShot: chooseShot,
    findCombo: findCombo,
    createPlan: createPlan,
    shouldCancelPlan: shouldCancelPlan,
    executePlan: executePlan,
  };
})(PowerBot);

/** Power bot module 05: side-specific scripted skill serves. */
(function (PB) {
  var A = {
    W: 'WAIT',
    F: 'FORWARD',
    FU: 'FORWARD_UP',
    B: 'BACKWARD',
    FH: 'FORWARD_HIT',
    FUH: 'FORWARD_UP_HIT',
    FDH: 'FORWARD_DOWN_HIT',
    UH: 'UP_HIT',
    DH: 'DOWN_HIT',
  };

  function phase(action, frames) {
    return { action: action, frames: frames };
  }

  var LEFT = [
    [
      phase(A.F, 1),
      phase(A.W, 20),
      phase(A.F, 26),
      phase(A.FU, 4),
      phase(A.FDH, 1),
    ],
    [
      phase(A.F, 1),
      phase(A.W, 20),
      phase(A.F, 30),
      phase(A.FU, 1),
      phase(A.FH, 2),
    ],
    [
      phase(A.F, 1),
      phase(A.W, 20),
      phase(A.F, 11),
      phase(A.FU, 15),
      phase(A.DH, 1),
      phase(A.FDH, 4),
    ],
    [
      phase(A.F, 1),
      phase(A.W, 20),
      phase(A.F, 11),
      phase(A.FU, 15),
      phase(A.FH, 1),
    ],
    [
      phase(A.F, 1),
      phase(A.W, 20),
      phase(A.F, 31),
      phase(A.FUH, 3),
      phase(A.W, 16),
      phase(A.DH, 5),
    ],
    [
      phase(A.F, 1),
      phase(A.W, 20),
      phase(A.F, 31),
      phase(A.FUH, 3),
      phase(A.W, 16),
      phase(A.UH, 1),
    ],
    [
      phase(A.F, 1),
      phase(A.W, 20),
      phase(A.F, 31),
      phase(A.FUH, 3),
      phase(A.W, 16),
      phase(A.FH, 1),
    ],
    [
      phase(A.F, 1),
      phase(A.W, 20),
      phase(A.F, 31),
      phase(A.FUH, 3),
      phase(A.W, 16),
      phase(A.B, 1),
    ],
    [
      phase(A.F, 7),
      phase(A.W, 14),
      phase(A.F, 11),
      phase(A.FU, 15),
      phase(A.DH, 5),
    ],
    [
      phase(A.F, 7),
      phase(A.W, 14),
      phase(A.F, 11),
      phase(A.FU, 15),
      phase(A.FH, 1),
    ],
  ];

  var RIGHT = [
    LEFT[0],
    LEFT[1],
    LEFT[2],
    LEFT[3],
    LEFT[4],
    LEFT[6],
    [
      phase(A.F, 7),
      phase(A.W, 14),
      phase(A.F, 11),
      phase(A.FU, 2),
      phase(A.W, 13),
      phase(A.FDH, 5),
    ],
    [
      phase(A.F, 7),
      phase(A.W, 14),
      phase(A.F, 11),
      phase(A.FU, 2),
      phase(A.W, 13),
      phase(A.FH, 1),
    ],
  ];

  var SIMPLE = [phase(A.FU, 1), phase(A.W, 11), phase(A.FUH, 1)];

  function toInput(side, action) {
    var toward = PB.towardNet(side);
    if (action === A.F) return { x: toward, y: 0, hit: 0 };
    if (action === A.FU) return { x: toward, y: -1, hit: 0 };
    if (action === A.B) return { x: -toward, y: 0, hit: 0 };
    if (action === A.FH) return { x: toward, y: 0, hit: 1 };
    if (action === A.FUH) return { x: toward, y: -1, hit: 1 };
    if (action === A.FDH) return { x: toward, y: 1, hit: 1 };
    if (action === A.UH) return { x: 0, y: -1, hit: 1 };
    if (action === A.DH) return { x: 0, y: 1, hit: 1 };
    return PB.neutral();
  }

  function quantizedFrames(frames, groupSize) {
    return Math.max(groupSize, Math.ceil(frames / groupSize) * groupSize);
  }

  function isInitialBall(ball) {
    return ball.y === 0 && ball.xVelocity === 0 && ball.yVelocity === 1;
  }

  function advancePhases(serve, elapsedFrames, groupSize) {
    var remainingElapsed = elapsedFrames;
    while (remainingElapsed > 0 && serve.phaseIndex < serve.script.length) {
      if (remainingElapsed < serve.framesLeft) {
        serve.framesLeft -= remainingElapsed;
        return;
      }
      remainingElapsed -= serve.framesLeft;
      serve.phaseIndex += 1;
      if (serve.phaseIndex < serve.script.length) {
        serve.framesLeft = quantizedFrames(
          serve.script[serve.phaseIndex].frames,
          groupSize
        );
      }
    }
  }

  function initialize(snapshot) {
    var servingSelf =
      (snapshot.side === 'RIGHT') === snapshot.meta.isPlayer2Serve;
    if (!servingSelf) {
      PB.state.serve = { active: false, done: true };
      return;
    }

    var scripts = snapshot.side === 'LEFT' ? LEFT : RIGHT;
    var script = PB.config.enableServeSkills ? PB.choose(scripts) : SIMPLE;
    PB.state.serve = {
      active: true,
      done: false,
      script: script,
      phaseIndex: 0,
      framesLeft: quantizedFrames(
        script[0].frames,
        snapshot.config.tickFrameGroupSize
      ),
      started: false,
      lastTick: null,
    };
  }

  function decide(snapshot) {
    if (PB.state.serve === null) initialize(snapshot);
    var serve = PB.state.serve;
    if (!serve.active || serve.done) return null;

    var groupSize = snapshot.config.tickFrameGroupSize;
    if (!serve.started) {
      if (isInitialBall(snapshot.ball)) {
        // Ready animation calls decide(), but physics is frozen.  Keep the first
        // input armed without consuming its duration.
        return toInput(snapshot.side, serve.script[0].action);
      }
      serve.started = true;
      serve.lastTick = snapshot.tick;
      // Before the first moving snapshot arrives, the first input has already
      // been held for a few physics frames.  On an untouched serve, vy-1 is the
      // exact number of elapsed engine frames.
      advancePhases(
        serve,
        Math.max(1, Math.min(groupSize, snapshot.ball.yVelocity - 1)),
        groupSize
      );
    } else {
      var elapsed = Math.max(1, snapshot.tick - serve.lastTick);
      serve.lastTick = snapshot.tick;
      advancePhases(serve, elapsed, groupSize);
    }

    if (serve.phaseIndex >= serve.script.length) {
      serve.active = false;
      serve.done = true;
      return null;
    }
    return toInput(snapshot.side, serve.script[serve.phaseIndex].action);
  }

  PB.serveMachine = {
    decide: decide,
    toInput: toInput,
    quantizedFrames: quantizedFrames,
    leftScripts: LEFT,
    rightScripts: RIGHT,
  };
})(PowerBot);

/** Power bot module 06: compose every module into the required decide(). */
(function (PB) {
  function isServeStart(snapshot) {
    var servingX = snapshot.meta.isPlayer2Serve ? 376 : 56;
    var elapsed = snapshot.ball.yVelocity - 1;
    return (
      snapshot.ball.x === servingX &&
      snapshot.ball.xVelocity === 0 &&
      elapsed >= 0 &&
      elapsed <= snapshot.config.tickFrameGroupSize + 1 &&
      snapshot.ball.y === (elapsed * (elapsed + 1)) / 2 &&
      snapshot.self.y === PB.C.PLAYER_GROUND_Y &&
      snapshot.opp.y === PB.C.PLAYER_GROUND_Y &&
      snapshot.self.state === 0 &&
      snapshot.opp.state === 0
    );
  }

  function updateRoundLifecycle(snapshot) {
    var total = snapshot.meta.score.self + snapshot.meta.score.opp;
    var initialPlacement = isServeStart(snapshot);

    if (PB.state.lastScoreTotal === null) {
      PB.state.lastScoreTotal = total;
      if (initialPlacement) {
        PB.resetRoundState(snapshot);
        return 'SETUP';
      }
      // A Worker may be restarted in the middle of a rally.  Do not invent a
      // serve sequence when the initial placement was never observed.
      PB.state.pendingRoundStart = false;
      PB.state.roundActive = true;
      PB.state.serve = { active: false, done: true };
      return 'ACTIVE';
    }

    if (total !== PB.state.lastScoreTotal) {
      PB.state.pendingRoundStart = true;
      PB.state.roundActive = false;
      PB.state.plan = null;
      PB.state.serve = null;
      PB.state.airShot = null;
    }
    PB.state.lastScoreTotal = total;
    PB.state.lastRallyFrame = snapshot.meta.rallyFrameCount;

    if (initialPlacement) {
      if (PB.state.pendingRoundStart) PB.resetRoundState(snapshot);
      return 'SETUP';
    }
    if (PB.state.pendingRoundStart) return 'WAITING_FOR_SETUP';
    PB.state.roundActive = true;
    return 'ACTIVE';
  }

  function immediateAirAttack(snapshot) {
    if (snapshot.self.state === 0) {
      PB.state.airShot = null;
      return null;
    }
    if (snapshot.self.state !== 1 && snapshot.self.state !== 2) return null;
    if (snapshot.self.state === 2 && PB.state.airShot) {
      return PB.offense.shotAction(
        snapshot.side,
        PB.state.airShot,
        PB.towardNet(snapshot.side)
      );
    }
    if (
      Math.abs(snapshot.ball.x - snapshot.self.x) >= 92 ||
      Math.abs(snapshot.ball.y - snapshot.self.y) >= 112
    ) {
      return null;
    }
    if (!PB.state.airShot) {
      PB.state.airShot = PB.offense.chooseShot(
        snapshot,
        snapshot.ball,
        PB.config.enableRandomVariation && PB.random() < 0.2
      ).shot;
    }
    return PB.offense.shotAction(
      snapshot.side,
      PB.state.airShot,
      PB.towardNet(snapshot.side)
    );
  }

  PB.decide = function (snapshot) {
    var lifecycle = updateRoundLifecycle(snapshot);

    if (lifecycle === 'WAITING_FOR_SETUP') {
      PB.state.lastSnapshot = snapshot;
      PB.state.lastAction = PB.neutral();
      return PB.state.lastAction;
    }

    PB.reach.updateEstimates(snapshot);

    var serveAction = PB.serveMachine.decide(snapshot);
    if (serveAction !== null) {
      PB.state.lastSnapshot = snapshot;
      PB.state.lastAction = serveAction;
      return serveAction;
    }

    if (snapshot.self.state === 3 || snapshot.self.state === 4) {
      PB.state.plan = null;
      PB.state.lastSnapshot = snapshot;
      PB.state.lastAction = PB.neutral();
      return PB.state.lastAction;
    }

    var leadFrames = PB.config.actionLeadFrames;
    var path = PB.physics.trace(snapshot.ball);

    var block = PB.defense.blockingAction(snapshot, path);
    if (block !== null) {
      PB.state.lastSnapshot = snapshot;
      PB.state.lastAction = block;
      return block;
    }

    if (PB.offense.shouldCancelPlan(snapshot, PB.state.plan)) {
      PB.state.plan = null;
    }
    if (PB.state.plan === null) {
      PB.state.plan = PB.offense.createPlan(snapshot, path);
    }

    var plannedAction = PB.offense.executePlan(snapshot, PB.state.plan);
    if (plannedAction !== null) {
      PB.state.lastSnapshot = snapshot;
      PB.state.lastAction = plannedAction;
      return plannedAction;
    }
    if (PB.state.plan !== null && PB.state.plan.phase === 'FIRST') {
      PB.state.plan = null;
    }

    if (PB.defense.shouldDive(snapshot, path)) {
      var landing = path[path.length - 1];
      var dive = {
        x: PB.moveToward(snapshot.self.x, landing.x, 0),
        y: 0,
        hit: 1,
      };
      PB.state.lastSnapshot = snapshot;
      PB.state.lastAction = dive;
      return dive;
    }

    var airAttack = immediateAirAttack(snapshot);
    if (airAttack !== null) {
      PB.state.lastSnapshot = snapshot;
      PB.state.lastAction = airAttack;
      return airAttack;
    }

    var target = PB.defense.target(snapshot, path);
    var action = {
      x: PB.moveToward(snapshot.self.x, target, 5),
      y: 0,
      hit: 0,
    };

    var contact = PB.reach.firstReachableContact(
      snapshot.side,
      snapshot.self,
      PB.state.selfYVelocity,
      path.slice(0, 24),
      true
    );
    if (
      contact &&
      snapshot.self.state === 0 &&
      contact.frame <= 20 + leadFrames &&
      contact.ball.y < snapshot.self.y - 10
    ) {
      action.y = -1;
    }

    PB.state.lastSnapshot = snapshot;
    PB.state.lastAction = action;
    return action;
  };
})(PowerBot);

function decide(snapshot) {
  return PowerBot.decide(snapshot);
}
