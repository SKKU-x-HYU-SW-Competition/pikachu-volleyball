/**
 * TEMPORARY Phase 1 smoke-test hook -- not the real test environment.
 * Phase 2 (docs/agent-dev/PHASES.md) will build a proper UI for picking
 * [keyboard | built-in AI | my bot] per side; this is just enough wiring
 * to manually verify PikaBotInput/botWorker actually work end-to-end in a
 * browser before that UI exists. Safe to delete once Phase 2 lands.
 *
 * Usage: open the game with ?bot=left, ?bot=right, or ?bot=both in the URL.
 * At the menu, pick "with friend" (2P) to test bot vs. your own keyboard,
 * or "with computer" (1P) -- picking it via the *other* side's key -- to
 * test bot vs. the built-in AI. See the query param handling below for why
 * both work with the same flag.
 */
'use strict';
import { PikaBotInput } from './botInput.js';
import { CHASE_BOT_SOURCE } from './exampleBots.js';

/**
 * @param {import('../pikavolley.js').PikachuVolleyball} pikaVolley
 * @param {import('@pixi/ticker').Ticker} ticker
 */
export function maybeAttachDevBot(pikaVolley, ticker) {
  const requested = new URLSearchParams(window.location.search).get('bot');
  if (!requested) {
    return;
  }
  const wantsLeft = requested === 'left' || requested === 'both';
  const wantsRight = requested === 'right' || requested === 'both';
  if (!wantsLeft && !wantsRight) {
    // eslint-disable-next-line no-console
    console.warn(
      `[devBotHook] unrecognized ?bot=${requested} (expected left|right|both)`
    );
    return;
  }

  // Dev/smoke-test only: expose the instance so it can be inspected from
  // outside (e.g. a headless-browser verification script). Only happens
  // when ?bot= is present, never in normal play.
  window.__pikaVolley = pikaVolley;

  // Wait until the round actually starts so the bot's decide() (which has
  // no notion of "menu screen") can't accidentally fire powerHit and mess
  // with menu navigation -- let a real keyboard drive the menu first.
  const waitForRound = () => {
    if (pikaVolley.state !== pikaVolley.round) {
      return;
    }
    ticker.remove(waitForRound);
    attachNow();
  };

  const attachNow = () => {
    if (wantsLeft) {
      if (pikaVolley.keyboardArray[0].destroy) {
        pikaVolley.keyboardArray[0].destroy();
      }
      pikaVolley.keyboardArray[0] = new PikaBotInput({
        side: 'LEFT',
        physics: pikaVolley.physics,
        getMeta: () => ({
          scores: pikaVolley.scores,
          isPlayer2Serve: pikaVolley.isPlayer2Serve,
        }),
        botSource: CHASE_BOT_SOURCE,
      });
      pikaVolley.physics.player1.isComputer = false;
      // eslint-disable-next-line no-console
      console.log('[devBotHook] LEFT (player1) is now bot-controlled');
    }
    if (wantsRight) {
      if (pikaVolley.keyboardArray[1].destroy) {
        pikaVolley.keyboardArray[1].destroy();
      }
      pikaVolley.keyboardArray[1] = new PikaBotInput({
        side: 'RIGHT',
        physics: pikaVolley.physics,
        getMeta: () => ({
          scores: pikaVolley.scores,
          isPlayer2Serve: pikaVolley.isPlayer2Serve,
        }),
        botSource: CHASE_BOT_SOURCE,
      });
      pikaVolley.physics.player2.isComputer = false;
      // eslint-disable-next-line no-console
      console.log('[devBotHook] RIGHT (player2) is now bot-controlled');
    }
  };

  ticker.add(waitForRound);
}
