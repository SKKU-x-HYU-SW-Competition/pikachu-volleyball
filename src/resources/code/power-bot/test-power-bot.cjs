'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const directory = __dirname;
const moduleNames = [
  '00-core.js',
  '01-physics-predictor.js',
  '02-state-and-reachability.js',
  '03-defense.js',
  '04-offense.js',
  '05-serve-machine.js',
  '06-controller.js',
];
const source = fs.readFileSync(path.join(directory, 'power-bot.js'), 'utf8');

function expectedBundle() {
  const banner = `/**
 * Generated modular power bot.
 * Paste this entire file into Bot Setup as JavaScript.
 * Source modules: ${moduleNames.join(', ')}
 */\n`;
  return (
    banner +
    moduleNames
      .map((name) => fs.readFileSync(path.join(directory, name), 'utf8').trim())
      .join('\n\n') +
    '\n'
  );
}

function loadExactWorkerBot() {
  // This is the same compilation shape used by botWorker.js.
  return new Function(
    source + "\n;return (typeof decide === 'function') ? decide : null;"
  )();
}

function loadInspectableBot() {
  const context = vm.createContext({ console });
  return new vm.Script(
    `(function () { ${source}\nreturn { decide, PowerBot }; })()`
  ).runInContext(context);
}

function snapshot(side, overrides = {}) {
  const right = side === 'RIGHT';
  const base = {
    tick: 3,
    side,
    self: {
      x: right ? 396 : 36,
      y: 244,
      state: 0,
      frameNumber: 0,
      divingDirection: 0,
    },
    opp: {
      x: right ? 36 : 396,
      y: 244,
      state: 0,
      frameNumber: 0,
      divingDirection: 0,
    },
    ball: {
      x: right ? 376 : 56,
      y: 0,
      xVelocity: 0,
      yVelocity: 1,
      expectedLandingPointX: right ? 376 : 56,
      isPowerHit: false,
    },
    meta: {
      score: { self: 0, opp: 0 },
      isPlayer2Serve: right,
      rallyFrameCount: 3,
    },
    config: { tickFrameGroupSize: 3 },
  };
  for (const [key, value] of Object.entries(overrides)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      base[key] &&
      typeof base[key] === 'object'
    ) {
      base[key] = Object.assign({}, base[key], value);
    } else {
      base[key] = value;
    }
  }
  return base;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value))
    return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function assertAction(action) {
  assert.ok(action && typeof action === 'object');
  assert.deepEqual(Object.keys(action).sort(), ['hit', 'x', 'y']);
  assert.ok(action.x === -1 || action.x === 0 || action.x === 1);
  assert.ok(action.y === -1 || action.y === 0 || action.y === 1);
  assert.ok(action.hit === 0 || action.hit === 1);
}

assert.equal(source, expectedBundle(), 'generated power-bot.js is stale');
assert.equal(typeof loadExactWorkerBot(), 'function');

for (const side of ['LEFT', 'RIGHT']) {
  const decide = loadExactWorkerBot();
  for (let tick = 3; tick <= 180; tick += 3) {
    const s = snapshot(side, {
      tick,
      self: { x: side === 'LEFT' ? 108 : 324 },
      opp: { x: side === 'LEFT' ? 324 : 108 },
      ball: {
        x: side === 'LEFT' ? 80 + (tick % 90) : 352 - (tick % 90),
        y: Math.min(240, 50 + (tick % 60) * 3),
        xVelocity: side === 'LEFT' ? 4 : -4,
        yVelocity: (tick % 24) - 12,
      },
      meta: { rallyFrameCount: tick },
    });
    const before = JSON.stringify(s);
    assertAction(decide(deepFreeze(s)));
    assert.equal(JSON.stringify(s), before, 'bot mutated its snapshot');
  }
}

const inspected = loadInspectableBot();
const PB = inspected.PowerBot;
const predictor = PB.physics;
const goldenCases = [
  {
    ball: { x: 100, y: 100, xVelocity: 5, yVelocity: 0 },
    frames: 18,
    landingX: 185,
  },
  {
    ball: { x: 205, y: 170, xVelocity: 10, yVelocity: 5 },
    frames: 24,
    landingX: 415,
  },
  {
    ball: { x: 30, y: 40, xVelocity: -12, yVelocity: -8 },
    frames: 31,
    landingX: 390,
  },
];
for (const testCase of goldenCases) {
  const ballPath = predictor.trace(testCase.ball);
  assert.equal(ballPath.landed, true);
  assert.equal(ballPath.length - 1, testCase.frames);
  assert.equal(ballPath[ballPath.length - 1].x, testCase.landingX);
  assert.equal(ballPath[ballPath.length - 1].y, 252);
  assert.equal(predictor.simulateAllShots(ballPath[0]).length, 6);
}

assert.equal(
  PB.reach.canTouch(
    'LEFT',
    { x: 184, y: 200, state: 1 },
    0,
    { x: 216, y: 200 },
    0,
    false
  ),
  true
);
assert.equal(
  PB.reach.canTouch(
    'RIGHT',
    { x: 248, y: 200, state: 1 },
    0,
    { x: 216, y: 200 },
    0,
    false
  ),
  true
);

// A second smash may keep the same horizontal direction.  The planner must
// recognize the vertical velocity discontinuity and finish without falling
// through to the broad immediate-air-attack fallback in the same decision.
const sameDirectionPlan = {
  phase: 'SECOND',
  secondArmedTick: 6,
  secondContactTick: 11,
  secondTargetX: 130,
  combo: { secondJump: false, juke: false },
  shot: PB.physics.shots[2],
  secondShot: PB.physics.shots[3],
};
PB.state.plan = sameDirectionPlan;
PB.state.lastSnapshot = snapshot('LEFT', {
  tick: 9,
  self: { x: 130, y: 210, state: 2 },
  ball: {
    x: 100,
    y: 100,
    xVelocity: 10,
    yVelocity: 0,
    isPowerHit: true,
  },
});
const completedSecondAction = PB.offense.executePlan(
  snapshot('LEFT', {
    tick: 12,
    self: { x: 130, y: 210, state: 2 },
    ball: {
      x: 130,
      y: 103,
      xVelocity: 10,
      yVelocity: -30,
      isPowerHit: true,
    },
  }),
  sameDirectionPlan
);
assertAction(completedSecondAction);
assert.equal(completedSecondAction.y, 0);
assert.equal(PB.state.plan, null);

// Static Ready frames must not consume the serve script.
const setupBot = loadInspectableBot();
for (let tick = 3; tick <= 30; tick += 3) {
  const action = setupBot.decide(
    snapshot('LEFT', { tick, meta: { rallyFrameCount: tick } })
  );
  assertAction(action);
  assert.equal(setupBot.PowerBot.state.serve.phaseIndex, 0);
  assert.equal(setupBot.PowerBot.state.serve.started, false);
}

// The first real Bot Setup snapshot arrives after physics has already advanced
// a couple of frames, so the ballistic prefix must still arm a skill serve.
const movingFirstFrameBot = loadInspectableBot();
const movingFirstAction = movingFirstFrameBot.decide(
  snapshot('LEFT', {
    tick: 3,
    ball: { y: 3, yVelocity: 3 },
    meta: { rallyFrameCount: 3 },
  })
);
assertAction(movingFirstAction);
assert.equal(movingFirstFrameBot.PowerBot.state.serve.active, true);
assert.equal(movingFirstFrameBot.PowerBot.state.serve.started, true);

// A score change arms the next round but dead-ball frames cannot start a serve.
const lifecycleBot = loadInspectableBot();
lifecycleBot.decide(
  snapshot('LEFT', {
    ball: { x: 120, y: 120, xVelocity: 4, yVelocity: 2 },
  })
);
for (let tick = 6; tick <= 36; tick += 3) {
  const action = lifecycleBot.decide(
    snapshot('LEFT', {
      tick,
      ball: { x: 100, y: 252, xVelocity: 0, yVelocity: -10 },
      meta: { score: { self: 1, opp: 0 }, rallyFrameCount: tick },
    })
  );
  assert.equal(JSON.stringify(action), JSON.stringify({ x: 0, y: 0, hit: 0 }));
  assert.equal(lifecycleBot.PowerBot.state.serve, null);
}
const readyAfterScore = lifecycleBot.decide(
  snapshot('LEFT', {
    tick: 39,
    meta: { score: { self: 1, opp: 0 }, rallyFrameCount: 39 },
  })
);
assertAction(readyAfterScore);
assert.equal(lifecycleBot.PowerBot.state.serve.phaseIndex, 0);

// Every adapted side-specific serve emits at least one hit phase at group=3.
for (const side of ['LEFT', 'RIGHT']) {
  const scripts =
    side === 'LEFT'
      ? PB.serveMachine.leftScripts
      : PB.serveMachine.rightScripts;
  for (const script of scripts) {
    PB.state.serve = {
      active: true,
      done: false,
      script,
      phaseIndex: 0,
      framesLeft: PB.serveMachine.quantizedFrames(script[0].frames, 3),
      started: true,
      lastTick: 3,
    };
    let emittedHit = false;
    for (let tick = 6; tick <= 240 && PB.state.serve.active; tick += 3) {
      const action = PB.serveMachine.decide(
        snapshot(side, {
          tick,
          ball: { y: 20, yVelocity: 4 },
          meta: { rallyFrameCount: tick },
        })
      );
      if (action && action.hit === 1) emittedHit = true;
    }
    assert.equal(emittedHit, true, `${side} serve missed its hit phase`);
  }
}

console.log('power-bot harness: ok');
