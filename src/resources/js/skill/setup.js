/**
 * Wires the gauge system (decision D-019) into the running game.
 *
 * Nothing here modifies the original engine files: the tracker observes
 * physics state that already exists, and the view is mounted as an extra child
 * of GameView's container. Same assembly-layer approach as bot/testSetup.js.
 */
'use strict';
import { GaugeTracker } from './gauge.js';
import { GaugeView } from './gaugeView.js';

/**
 * @param {import('../pikavolley.js').PikachuVolleyball} pikaVolley
 * @param {import('@pixi/ticker').Ticker} ticker
 * @param {Object.<string,import('@pixi/loaders').LoaderResource>} resources loader.resources
 * @return {GaugeTracker} exposed so later skill code can read the gauges
 */
export function setUpGauge(pikaVolley, ticker, resources) {
  const tracker = new GaugeTracker();
  const view = new GaugeView(resources);

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
