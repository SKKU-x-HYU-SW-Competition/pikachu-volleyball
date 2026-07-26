/**
 * Phase 2 test environment (docs/agent-dev/PHASES.md Phase 2): lets a
 * tester freely set each side to [keyboard | bot code | built-in AI] and
 * try any combination -- my bot vs my own keyboard, my bot vs the built-in
 * AI, bot vs bot, etc. Replaces the Phase 1 devBotHook.js query-param hack.
 *
 * Design notes:
 * - "keyboard" mode is left completely alone (no isComputer/keyboardArray
 *   override) so the classic menu-driven 1P-vs-AI / 2P flow keeps working
 *   exactly as before for a side nobody touches here. Only "bot" and "ai"
 *   modes actively force isComputer and swap keyboardArray.
 * - Settings only take effect once a match's round actually starts (Apply
 *   calls pikaVolley.restart(), which sends the game back through
 *   intro -> menu -> ...) -- see docs/agent-dev/DECISIONS.md. Swapping
 *   keyboardArray mid-round would risk leaving the physics engine in an
 *   inconsistent state.
 * - keyboardArray is continuously synced with the current game state (see
 *   syncWithGameState below), not just applied once: bot/AI slots are only
 *   installed while a match is actually in progress (round /
 *   afterEndOfRound / beforeStartOfNextRound), and swapped back to real
 *   keyboards the moment we leave that (back to intro/menu) so a human can
 *   navigate the next match's menu. Without this, once a match configured
 *   as bot-vs-bot ends, nothing would ever press powerHit to get through
 *   intro/menu again and the game would appear stuck
 *   (docs/agent-dev/decisions/ADR-0011-bot-setup-menu-navigation.md).
 * - Settings persist in localStorage (decision: keep across reloads) via
 *   the same localStorageWrapper the rest of the UI already uses.
 */
'use strict';
import { PikaKeyboard } from '../keyboard.js';
import { PikaBotInput } from './botInput.js';
import { NullInput } from './nullInput.js';
import { CHASE_BOT_SOURCE } from './exampleBots.js';
import { localStorageWrapper } from '../utils/local_storage_wrapper.js';

/** @typedef {'keyboard'|'bot'|'ai'} SideMode */

const DEFAULT_MODE = 'keyboard';

const STORAGE_KEYS = {
  left: { mode: 'pv-bot-left-mode', source: 'pv-bot-left-source' },
  right: { mode: 'pv-bot-right-mode', source: 'pv-bot-right-source' },
};

const SIDE_INFO = {
  left: { slotIndex: 0, engineSide: 'LEFT' },
  right: { slotIndex: 1, engineSide: 'RIGHT' },
};

/**
 * @param {import('../pikavolley.js').PikachuVolleyball} pikaVolley
 * @param {import('@pixi/ticker').Ticker} ticker
 */
export function setUpBotTestUI(pikaVolley, ticker) {
  const els = collectElements();
  if (!els) {
    // Markup not present in this locale's HTML -- nothing to wire up.
    return;
  }
  // @ts-ignore -- matches how main.js enables the other menu-bar buttons
  els.openBtn.disabled = false;

  // This whole module is a dev/test tool, so always expose the instance for
  // inspection from devtools / automation scripts (e.g. window.__pikaVolley
  // .physics.player2.x), same as the old devBotHook.js did.
  window.__pikaVolley = pikaVolley;

  // Typing bot code (which is full of letters like z/d/g/r/v/f) must not
  // leak into the game's window-level key listeners (PikaKeyboard), or
  // typing would both insert garbage *and* move players / trigger hits.
  els.box.addEventListener('keydown', (event) => event.stopPropagation());
  els.box.addEventListener('keyup', (event) => event.stopPropagation());

  /** @type {{left: PikaBotInput|null, right: PikaBotInput|null}} */
  const activeBotInputs = { left: null, right: null };

  let config = loadConfig();
  populateUI(els, config);

  // A match is made of round <-> afterEndOfRound <-> beforeStartOfNextRound
  // (rally-to-rally transitions within the *same* match; scores carry
  // over). Only once all of that ends does the game cycle back through
  // intro -> menu -> ... for the *next* match. Bot/AI slots only make
  // sense while a match is actually in progress: during intro/menu, the
  // human still needs a real keyboard to press powerHit/select, and a bot
  // has no idea it's looking at a frozen menu screen (see
  // docs/agent-dev/decisions/ADR-0011-bot-setup-menu-navigation.md).
  const isDuringMatch = () =>
    pikaVolley.state === pikaVolley.round ||
    pikaVolley.state === pikaVolley.afterEndOfRound ||
    pikaVolley.state === pikaVolley.beforeStartOfNextRound;

  // Tracks whether keyboardArray currently reflects `config` (bot/AI
  // swapped in) vs plain keyboards (needed for menu navigation). Re-synced
  // every tick below rather than "once when Apply is clicked", so it keeps
  // correctly toggling across every match, not just the first one.
  let isConfigApplied = false;
  const syncWithGameState = () => {
    const duringMatch = isDuringMatch();
    if (duringMatch && !isConfigApplied) {
      applySide(pikaVolley, 'left', config.left, els, activeBotInputs);
      applySide(pikaVolley, 'right', config.right, els, activeBotInputs);
      isConfigApplied = true;
    } else if (!duringMatch && isConfigApplied) {
      restoreKeyboardsForMenuNavigation(pikaVolley, activeBotInputs);
      setStatus(els, 'left', '');
      setStatus(els, 'right', '');
      isConfigApplied = false;
    }
  };
  ticker.add(syncWithGameState);

  els.openBtn.addEventListener('click', () => {
    els.box.classList.remove('hidden');
  });
  els.closeBtn.addEventListener('click', () => {
    els.box.classList.add('hidden');
  });

  ['left', 'right'].forEach((side) => {
    Array.from(els[side].modeGroup.children).forEach((btn) => {
      btn.addEventListener('click', () => {
        // Build a new object rather than mutating config[side] in place --
        // syncWithGameState above reads `config` directly, and mutating a
        // nested object in place is just asking for a stale-reference bug
        // like docs/agent-dev/decisions/ADR-0010-bot-setup-double-listener-bug.md.
        config = Object.assign({}, config, {
          [side]: { mode: btn.dataset.mode, source: config[side].source },
        });
        setSelectedModeBtn(els, side, btn.dataset.mode);
      });
    });
    els[side].exampleBtn.addEventListener('click', () => {
      els[side].source.value = CHASE_BOT_SOURCE;
    });
  });

  els.applyBtn.addEventListener('click', () => {
    config = {
      left: { mode: config.left.mode, source: els.left.source.value },
      right: { mode: config.right.mode, source: els.right.source.value },
    };
    saveConfig(config);
    // restart() sends the game back through intro -> menu -> ... -- once
    // the next match's round actually starts, syncWithGameState (armed
    // above) applies this new config automatically. No explicit "apply
    // now" call needed here.
    pikaVolley.restart();
  });
}

/**
 * @param {import('../pikavolley.js').PikachuVolleyball} pikaVolley
 * @param {'left'|'right'} side
 * @param {{mode: SideMode, source: string}} sideConfig
 * @param {ReturnType<typeof collectElements>} els
 * @param {{left: PikaBotInput|null, right: PikaBotInput|null}} activeBotInputs
 */
function applySide(pikaVolley, side, sideConfig, els, activeBotInputs) {
  const { slotIndex, engineSide } = SIDE_INFO[side];
  const player =
    engineSide === 'LEFT'
      ? pikaVolley.physics.player1
      : pikaVolley.physics.player2;

  if (sideConfig.mode === 'keyboard') {
    // Leave isComputer untouched -- the menu screen already set it
    // correctly for this side (either via 1P/2P selection). Only restore a
    // real PikaKeyboard if we previously swapped this slot out for a bot/AI.
    if (!(pikaVolley.keyboardArray[slotIndex] instanceof PikaKeyboard)) {
      destroySlot(pikaVolley, slotIndex, activeBotInputs, side);
      pikaVolley.keyboardArray[slotIndex] = createDefaultKeyboard(engineSide);
    }
    return;
  }

  destroySlot(pikaVolley, slotIndex, activeBotInputs, side);

  if (sideConfig.mode === 'ai') {
    pikaVolley.keyboardArray[slotIndex] = new NullInput();
    player.isComputer = true;
    setStatus(els, side, '기본 AI로 동작 중');
    return;
  }

  // sideConfig.mode === 'bot'
  player.isComputer = false;
  const botInput = new PikaBotInput({
    side: engineSide,
    physics: pikaVolley.physics,
    getMeta: () => ({
      scores: pikaVolley.scores,
      isPlayer2Serve: pikaVolley.isPlayer2Serve,
    }),
    botSource: sideConfig.source,
    onInitResult: ({ ok, error }) => {
      setStatus(els, side, ok ? '봇 코드 로드됨' : '에러: ' + error);
    },
  });
  pikaVolley.keyboardArray[slotIndex] = botInput;
  activeBotInputs[side] = botInput;
  setStatus(els, side, '봇 로딩 중...');
}

/**
 * Put real, physical-key-driven keyboards back in both slots so a human can
 * navigate intro/menu (press powerHit to skip intro, select 1P/2P, etc.)
 * regardless of what the Bot Setup panel is configured to do once the next
 * match's round actually starts. Bots have no notion of "this is a menu
 * screen, not a rally" -- physics.runEngineForNextFrame (and therefore the
 * ball/player state a bot's decide() reasons about) isn't even called
 * outside of round(), so a bot's decision here would just be based on
 * whatever stale state was left over from the previous match, which is not
 * something that reliably presses powerHit to advance.
 *
 * @param {import('../pikavolley.js').PikachuVolleyball} pikaVolley
 * @param {{left: PikaBotInput|null, right: PikaBotInput|null}} activeBotInputs
 */
function restoreKeyboardsForMenuNavigation(pikaVolley, activeBotInputs) {
  ['left', 'right'].forEach((side) => {
    const { slotIndex, engineSide } = SIDE_INFO[side];
    if (!(pikaVolley.keyboardArray[slotIndex] instanceof PikaKeyboard)) {
      destroySlot(pikaVolley, slotIndex, activeBotInputs, side);
      pikaVolley.keyboardArray[slotIndex] = createDefaultKeyboard(engineSide);
    }
  });
}

/**
 * @param {import('../pikavolley.js').PikachuVolleyball} pikaVolley
 * @param {number} slotIndex
 * @param {{left: PikaBotInput|null, right: PikaBotInput|null}} activeBotInputs
 * @param {'left'|'right'} side
 */
function destroySlot(pikaVolley, slotIndex, activeBotInputs, side) {
  const current = pikaVolley.keyboardArray[slotIndex];
  if (current && typeof current.destroy === 'function') {
    current.destroy();
  }
  activeBotInputs[side] = null;
}

/**
 * @param {'LEFT'|'RIGHT'} engineSide
 * @return {PikaKeyboard}
 */
function createDefaultKeyboard(engineSide) {
  if (engineSide === 'LEFT') {
    return new PikaKeyboard('KeyD', 'KeyG', 'KeyR', 'KeyV', 'KeyZ', 'KeyF');
  }
  return new PikaKeyboard(
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Enter'
  );
}

/**
 * @return {{
 *   openBtn: Element, box: Element, closeBtn: Element, applyBtn: Element,
 *   left: {modeGroup: Element, source: HTMLTextAreaElement, exampleBtn: Element, status: Element},
 *   right: {modeGroup: Element, source: HTMLTextAreaElement, exampleBtn: Element, status: Element},
 * }|null}
 */
function collectElements() {
  const openBtn = document.getElementById('bot-setup-btn');
  const box = document.getElementById('bot-setup-box');
  if (!openBtn || !box) {
    return null;
  }
  const forSide = (side) => ({
    modeGroup: document.getElementById(`bot-setup-${side}-mode`),
    source: document.getElementById(`bot-setup-${side}-source`),
    exampleBtn: document.getElementById(`bot-setup-${side}-example-btn`),
    status: document.getElementById(`bot-setup-${side}-status`),
  });
  return {
    openBtn,
    box,
    closeBtn: document.getElementById('bot-setup-close-btn'),
    applyBtn: document.getElementById('bot-setup-apply-btn'),
    left: forSide('left'),
    right: forSide('right'),
  };
}

/**
 * @return {{left: {mode: SideMode, source: string}, right: {mode: SideMode, source: string}}}
 */
function loadConfig() {
  return {
    left: {
      mode: localStorageWrapper.get(STORAGE_KEYS.left.mode) || DEFAULT_MODE,
      source: localStorageWrapper.get(STORAGE_KEYS.left.source) || '',
    },
    right: {
      mode: localStorageWrapper.get(STORAGE_KEYS.right.mode) || DEFAULT_MODE,
      source: localStorageWrapper.get(STORAGE_KEYS.right.source) || '',
    },
  };
}

/**
 * @param {{left: {mode: SideMode, source: string}, right: {mode: SideMode, source: string}}} config
 */
function saveConfig(config) {
  localStorageWrapper.set(STORAGE_KEYS.left.mode, config.left.mode);
  localStorageWrapper.set(STORAGE_KEYS.left.source, config.left.source);
  localStorageWrapper.set(STORAGE_KEYS.right.mode, config.right.mode);
  localStorageWrapper.set(STORAGE_KEYS.right.source, config.right.source);
}

/**
 * @param {ReturnType<typeof collectElements>} els
 * @param {{left: {mode: SideMode, source: string}, right: {mode: SideMode, source: string}}} config
 */
function populateUI(els, config) {
  els.left.source.value = config.left.source;
  els.right.source.value = config.right.source;
  setSelectedModeBtn(els, 'left', config.left.mode);
  setSelectedModeBtn(els, 'right', config.right.mode);
}

/**
 * @param {ReturnType<typeof collectElements>} els
 * @param {'left'|'right'} side
 * @param {SideMode} mode
 */
function setSelectedModeBtn(els, side, mode) {
  Array.from(els[side].modeGroup.children).forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.mode === mode);
  });
}

/**
 * @param {ReturnType<typeof collectElements>} els
 * @param {'left'|'right'} side
 * @param {string} text
 */
function setStatus(els, side, text) {
  els[side].status.textContent = text;
}
