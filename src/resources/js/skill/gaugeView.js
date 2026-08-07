/**
 * Renders the two gauge bars (decision D-019).
 *
 * Drawn with stretched solid-colour tiles from the existing sprite sheet
 * rather than @pixi/graphics, because the project only depends on the canvas
 * renderer bundles and does not ship a Graphics package. This is the same
 * trick FadeInOut uses for its full-screen black rectangle (view.js:651).
 */
'use strict';
import { Sprite } from '@pixi/sprite';
import { Container } from '@pixi/display';
import { ASSETS_PATH } from '../assets_path.js';
import { GAUGE_MAX } from './gauge.js';

const TEXTURES = ASSETS_PATH.TEXTURES;

/**
 * Bar geometry. Width matches a score board (two 32x32 numbers) and the bars
 * sit right under them, so the gauge reads as belonging to that player's
 * score. Score boards are at y = 10 and are 32px tall (view.js:415-418).
 * @constant
 */
const BAR = {
  width: 64,
  height: 6,
  y: 46,
  leftX: 14, // same inset as scoreBoards[0]
  rightX: 432 - 32 - 32 - 14, // same inset as scoreBoards[1]
  borderThickness: 1,
};

/**
 * The two gauge bars, as one container to be mounted inside GameView so that
 * it inherits GameView's visibility and stays underneath the fade overlay.
 */
export class GaugeView {
  /**
   * @param {Object.<string,import('@pixi/loaders').LoaderResource>} resources loader.resources
   */
  constructor(resources) {
    const textures = resources[ASSETS_PATH.SPRITE_SHEET].textures;

    this.container = new Container();

    /** @type {Sprite[]} filled portion of [player1, player2] bar */
    this.fills = [];

    for (let i = 0; i < 2; i++) {
      const x = i === 0 ? BAR.leftX : BAR.rightX;

      const border = makeStretchedSprite(textures, TEXTURES.BLACK);
      border.x = x - BAR.borderThickness;
      border.y = BAR.y - BAR.borderThickness;
      border.width = BAR.width + 2 * BAR.borderThickness;
      border.height = BAR.height + 2 * BAR.borderThickness;

      const track = makeStretchedSprite(textures, TEXTURES.GROUND_RED);
      track.x = x;
      track.y = BAR.y;
      track.width = BAR.width;
      track.height = BAR.height;

      const fill = makeStretchedSprite(textures, TEXTURES.GROUND_YELLOW);
      fill.y = BAR.y;
      fill.height = BAR.height;
      // Player 2's bar grows right-to-left so that both bars fill outward from
      // the net, mirroring the two sides of the court.
      fill.anchor.x = i === 0 ? 0 : 1;
      fill.x = i === 0 ? x : x + BAR.width;

      this.container.addChild(border);
      this.container.addChild(track);
      this.container.addChild(fill);
      this.fills.push(fill);
    }
  }

  /**
   * @param {number[]} gauges gauge of [player1, player2]
   */
  draw(gauges) {
    for (let i = 0; i < 2; i++) {
      const ratio = gauges[i] / GAUGE_MAX;
      // A zero-width sprite still renders a hairline in the canvas renderer,
      // so hide the fill entirely when the gauge is empty.
      this.fills[i].visible = ratio > 0;
      this.fills[i].width = BAR.width * ratio;
    }
  }
}

/**
 * @param {Object.<string,import('@pixi/core').Texture>} textures
 * @param {string} path
 * @return {Sprite} top-left anchored sprite, ready to be stretched
 */
function makeStretchedSprite(textures, path) {
  const sprite = new Sprite(textures[path]);
  sprite.anchor.x = 0;
  sprite.anchor.y = 0;
  return sprite;
}
