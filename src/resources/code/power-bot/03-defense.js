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
