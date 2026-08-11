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
