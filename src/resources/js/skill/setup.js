/**
 * Wires the gauge system (decision D-020) into the running game.
 *
 * Nothing here modifies the original engine files: the tracker observes
 * physics state that already exists, and the view is mounted as an extra child
 * of GameView's container. Same assembly-layer approach as bot/testSetup.js.
 */
'use strict';
import { GaugeTracker } from './gauge.js';
import { GaugeView } from './gaugeView.js';
import { ClawTracker, CLAW_KEY_P1, CLAW_KEY_P2 } from './claw.js';
import { ClawView } from './clawView.js';

/**
 * @param {import('../pikavolley.js').PikachuVolleyball} pikaVolley
 * @param {import('@pixi/ticker').Ticker} ticker
 * @return {GaugeTracker} exposed so later skill code can read the gauges
 */
export function setUpGauge(pikaVolley, ticker) {
  const tracker = new GaugeTracker();
  const view = new GaugeView();

  // Mounting inside GameView rather than on the stage means the bars follow
  // GameView's visibility (hidden during intro/menu) and stay below the fade
  // overlay, which pikavolley.js adds to the stage after GameView.
  pikaVolley.view.game.container.addChild(view.container);

  // Runs after main.js's own ticker callback, so pikaVolley.gameLoop() has
  // already advanced the frame this tick and the collision flags are current.
  ticker.add(() => {
    tracker.observe(pikaVolley);
    view.draw(tracker.gauges);
  });

  return tracker;
}

/**
 * Wire the claw skill (ADR-0021) into the running game.
 *
 * The cast key is read with a plain keydown listener instead of extending
 * PikaKeyboard: skill input lives outside the engine's three-field protocol
 * (xDirection/yDirection/powerHit), and putting it in the keyboard class would
 * leak it into the bot and built-in-AI slots that share keyboardArray.
 *
 * @param {import('../pikavolley.js').PikachuVolleyball} pikaVolley
 * @param {import('@pixi/ticker').Ticker} ticker
 * @param {Object.<string,import('@pixi/loaders').LoaderResource>} resources loader.resources
 * @param {GaugeTracker} gaugeTracker the tracker casts are paid from
 * @return {ClawTracker}
 */
export function setUpClaw(pikaVolley, ticker, resources, gaugeTracker) {
  const tracker = new ClawTracker(gaugeTracker);
  const view = new ClawView(resources);

  pikaVolley.view.game.container.addChild(view.container);

  window.addEventListener('keydown', (event) => {
    // event.repeat filters the OS key-repeat storm while a key is held; a cast
    // should cost gauge once per press. (A held key still cannot double-cast,
    // since tryCast refuses while a claw is in flight -- this is just to avoid
    // spending the gauge again the instant the previous claw resolves.)
    if (event.repeat) {
      return;
    }
    if (event.code === CLAW_KEY_P1) {
      tracker.tryCast(0, pikaVolley);
    } else if (event.code === CLAW_KEY_P2) {
      tracker.tryCast(1, pikaVolley);
    }
  });

  ticker.add(() => {
    castForBots(pikaVolley, tracker);
    tracker.observe(pikaVolley);
    view.draw(tracker.claws);
  });

  return tracker;
}

/**
 * Let bot-controlled sides cast, using the x their latest response asked for.
 *
 * Reading it off keyboardArray keeps the skill layer decoupled from how a side
 * is being driven: a keyboard or the built-in AI simply has no consumeSkillX,
 * so nothing happens for them. Draining is what limits a bot to one cast per
 * response rather than one per frame (CONTRACTS.md 1.1).
 *
 * @param {import('../pikavolley.js').PikachuVolleyball} pikaVolley
 * @param {ClawTracker} tracker
 */
function castForBots(pikaVolley, tracker) {
  for (let i = 0; i < 2; i++) {
    const input = pikaVolley.keyboardArray[i];
    if (!input || typeof input.consumeSkillX !== 'function') {
      continue;
    }
    const skillX = input.consumeSkillX();
    if (skillX !== null) {
      tracker.tryCast(i, pikaVolley, skillX);
    }
  }
}
