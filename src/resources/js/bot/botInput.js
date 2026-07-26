/**
 * Bot-controlled counterpart to PikaKeyboard (../keyboard.js). Drop a
 * PikaBotInput into PikachuVolleyball#keyboardArray in place of a
 * PikaKeyboard and the physics engine can't tell the difference -- both
 * only need to satisfy the PikaUserInput contract (xDirection/yDirection/
 * powerHit), see docs/agent-dev/CONTRACTS.md §1.0.
 *
 * side: 'LEFT' bots must occupy keyboardArray[0], 'RIGHT' bots must occupy
 * keyboardArray[1] (physicsEngine pairs userInputArray[i] with player1/
 * player2 by index -- see physics.js).
 */
'use strict';
import { PikaUserInput } from '../physics.js';
import {
  buildGameStateSnapshot,
  isValidBotAction,
  NEUTRAL_ACTION,
  TICK_FRAME_GROUP_SIZE,
  BOT_RESPONSE_TIMEOUT_MS,
  MAX_CONSECUTIVE_TIMEOUTS_BEFORE_RESTART,
} from './botContract.js';

export class PikaBotInput extends PikaUserInput {
  /**
   * @param {Object} args
   * @param {'LEFT'|'RIGHT'} args.side
   * @param {import('../physics.js').PikaPhysics} args.physics
   * @param {function(): {scores: number[], isPlayer2Serve: boolean}} args.getMeta
   * @param {string} args.botSource bot's source code; must define a
   *   top-level `decide(snapshot)` function (see botWorker.js)
   * @param {function({ok: boolean, error: (string|undefined)}): void} [args.onInitResult]
   *   called once when the Worker finishes (re-)loading botSource -- lets UI
   *   surface "bot code loaded" vs "syntax error: ..." to a human tester.
   */
  constructor({ side, physics, getMeta, botSource, onInitResult }) {
    super();

    this.side = side;
    this.physics = physics;
    this.getMeta = getMeta;
    this.botSource = botSource;
    this.onInitResult = onInitResult || null;

    /** @type {number} monotonically increasing tick counter for this input */
    this.tick = 0;
    /** @type {number} ticks elapsed since the current rally started */
    this.rallyFrameCount = 0;
    /** @type {number} sum of both scores as of the last tick, used to detect rally resets */
    this.previousScoreTotal = 0;

    /** @type {{x: number, y: number, hit: number}} last action resolved from the bot's Worker */
    this.latestAction = Object.assign({}, NEUTRAL_ACTION);

    /** @type {number|null} requestId currently awaiting a Worker response, if any */
    this.pendingRequestId = null;
    this.nextRequestId = 1;
    /** @type {number|null} setTimeout handle for the pending request's timeout guard */
    this.timeoutHandle = null;
    /** @type {number} consecutive timeouts, used to detect a hung Worker (D-003) */
    this.consecutiveTimeouts = 0;

    /** @type {Worker|null} */
    this.worker = null;
    this.spawnWorker();
  }

  /**
   * (Re)spawn the Worker that runs this bot's code, isolated from the main
   * thread (decision D-003). Any request the previous Worker had pending is
   * abandoned -- its eventual response, if it ever comes, is ignored because
   * handleWorkerMessage() checks requestId against a fresh worker generation.
   */
  spawnWorker() {
    if (this.worker !== null) {
      this.worker.terminate();
    }
    this.pendingRequestId = null;
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    this.consecutiveTimeouts = 0;

    this.worker = new Worker(new URL('./botWorker.js', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (event) => this.handleWorkerMessage(event.data);
    this.worker.postMessage({ type: 'init', source: this.botSource });
  }

  /**
   * @param {{type: string, requestId?: number, action?: Object, ok?: boolean, error?: string}} message
   */
  handleWorkerMessage(message) {
    if (message.type === 'initResult') {
      if (this.onInitResult) {
        this.onInitResult({ ok: message.ok, error: message.error });
      }
      return;
    }
    if (message.type !== 'result') {
      return;
    }
    // A stale reply from an earlier (already timed-out, or superseded)
    // request -- ignore it so it can't clobber a more recent result.
    if (message.requestId !== this.pendingRequestId) {
      return;
    }
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    this.pendingRequestId = null;

    if (message.action !== null && isValidBotAction(message.action)) {
      this.latestAction = message.action;
      this.consecutiveTimeouts = 0;
    } else {
      // Malformed action or a thrown error inside decide() -> neutral (D-002).
      this.latestAction = Object.assign({}, NEUTRAL_ACTION);
    }
  }

  /**
   * @param {number} requestId the request this timeout guard was armed for
   */
  handleTimeout(requestId) {
    // A response arrived just as the timeout fired, or a newer request has
    // since been dispatched -- this timeout is no longer relevant.
    if (requestId !== this.pendingRequestId) {
      return;
    }
    this.pendingRequestId = null;
    this.timeoutHandle = null;
    this.latestAction = Object.assign({}, NEUTRAL_ACTION);
    this.consecutiveTimeouts++;
    if (this.consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS_BEFORE_RESTART) {
      this.spawnWorker();
    }
  }

  /**
   * Freeze this tick's input. Called once per game frame from
   * PikachuVolleyball#gameLoop, mirroring PikaKeyboard#getInput.
   *
   * Because the bot runs in a Worker, its response for this tick's snapshot
   * cannot arrive synchronously -- browsers disallow blocking the main
   * thread on a Worker reply (Atomics.wait is Worker-only). So this method
   * applies whatever action resolved most recently (typically the previous
   * tick's decision -- roughly one tick of latency) and, in the background,
   * kicks off the request for the *next* tick's action. See
   * docs/agent-dev/CONTRACTS.md D-009 for the full reasoning.
   */
  getInput() {
    this.xDirection = this.latestAction.x;
    this.yDirection = this.latestAction.y;
    this.powerHit = this.latestAction.hit;

    const meta = this.getMeta();
    const currentScoreTotal = meta.scores[0] + meta.scores[1];
    if (currentScoreTotal !== this.previousScoreTotal) {
      this.rallyFrameCount = 0;
      this.previousScoreTotal = currentScoreTotal;
    } else {
      this.rallyFrameCount++;
    }

    this.tick++;
    if (this.tick % TICK_FRAME_GROUP_SIZE !== 0) {
      return;
    }
    // Previous request hasn't resolved yet (bot is slower than one tick
    // group) -- don't pile up requests, just wait for it (or its timeout).
    if (this.pendingRequestId !== null) {
      return;
    }

    const snapshot = buildGameStateSnapshot({
      tick: this.tick,
      side: this.side,
      physics: this.physics,
      meta: meta,
      rallyFrameCount: this.rallyFrameCount,
    });

    const requestId = this.nextRequestId++;
    this.pendingRequestId = requestId;
    this.worker.postMessage({
      type: 'tick',
      requestId: requestId,
      snapshot: snapshot,
    });
    this.timeoutHandle = setTimeout(() => {
      this.handleTimeout(requestId);
    }, BOT_RESPONSE_TIMEOUT_MS);
  }

  /**
   * Release the Worker. Call this when swapping this bot out of
   * keyboardArray (e.g. switching test-environment modes) so its Worker
   * doesn't keep running in the background.
   */
  destroy() {
    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }
    if (this.worker !== null) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
