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
