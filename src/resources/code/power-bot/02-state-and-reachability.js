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
