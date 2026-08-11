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
