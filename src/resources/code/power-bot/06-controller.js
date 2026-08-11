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
