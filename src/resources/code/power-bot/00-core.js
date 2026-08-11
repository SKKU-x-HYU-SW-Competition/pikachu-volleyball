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
