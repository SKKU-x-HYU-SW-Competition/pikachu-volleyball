/**
 * Phase 2 test environment (docs/agent-dev/PHASES.md Phase 2): lets a
 * tester freely set each side to [keyboard | bot code | built-in AI] and
 * try any combination -- my bot vs my own keyboard, my bot vs the built-in
 * AI, bot vs bot, etc. Replaces the Phase 1 devBotHook.js query-param hack.
 *
 * Phase 5 (docs/agent-dev/PHASES.md Phase 5, ADR-0012~0018) adds a
 * per-side language selector (JavaScript | Python) so the same "bot"
 * mode can run either a JS `decide()` or a Python `decide()` -- the
 * PikaBotInput picks the right Worker script from its `language`
 * argument (see botInput.js).
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
import { CHASE_BOT_SOURCE, CHASE_BOT_SOURCE_PY } from './exampleBots.js';
import { BOT_LANGUAGE } from './botContract.js';
import { localStorageWrapper } from '../utils/local_storage_wrapper.js';

/** @typedef {'keyboard'|'bot'|'ai'} SideMode */
/** @typedef {'js'|'py'} SideLanguage */

const DEFAULT_MODE = 'keyboard';
const DEFAULT_LANGUAGE = BOT_LANGUAGE.JS;

const STORAGE_KEYS = {
  left: {
    mode: 'pv-bot-left-mode',
    source: 'pv-bot-left-source',
    language: 'pv-bot-left-language',
  },
  right: {
    mode: 'pv-bot-right-mode',
    source: 'pv-bot-right-source',
    language: 'pv-bot-right-language',
  },
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
          [side]: Object.assign({}, config[side], { mode: btn.dataset.mode }),
        });
        setSelectedModeBtn(els, side, btn.dataset.mode);
      });
    });
    if (els[side].languageGroup) {
      Array.from(els[side].languageGroup.children).forEach((btn) => {
        btn.addEventListener('click', () => {
          config = Object.assign({}, config, {
            [side]: Object.assign({}, config[side], {
              language: btn.dataset.language,
            }),
          });
          setSelectedLanguageBtn(els, side, btn.dataset.language);
        });
      });
    }
    els[side].exampleBtn.addEventListener('click', () => {
      // Language field reflects the *currently selected* radio button, not
      // the last-saved config, so switching language + clicking the
      // example button loads the corresponding language's example.
      els[side].source.value =
        config[side].language === BOT_LANGUAGE.PY
          ? CHASE_BOT_SOURCE_PY
          : CHASE_BOT_SOURCE;
    });
  });

  els.applyBtn.addEventListener('click', () => {
    config = {
      left: Object.assign({}, config.left, { source: els.left.source.value }),
      right: Object.assign({}, config.right, {
        source: els.right.source.value,
      }),
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
 * @param {{mode: SideMode, source: string, language: SideLanguage}} sideConfig
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
    language: sideConfig.language,
    onInitResult: (event) => {
      setStatus(els, side, initPhaseToStatus(sideConfig.language, event));
    },
  });
  pikaVolley.keyboardArray[slotIndex] = botInput;
  activeBotInputs[side] = botInput;
  setStatus(
    els,
    side,
    sideConfig.language === BOT_LANGUAGE.PY
      ? 'Python 러너 시작 중...'
      : '봇 로딩 중...'
  );
}

/**
 * Translate an onInitResult event into a Korean status string. Python has
 * multi-phase progress (Pyodide load -> numpy load -> source exec -> ok);
 * JS has a single terminal event.
 * @param {SideLanguage} language
 * @param {{phase: string, ok: (boolean|undefined), error: (string|undefined)}} event
 * @return {string}
 */
function initPhaseToStatus(language, event) {
  if (event.phase === 'ok') {
    return '봇 코드 로드됨';
  }
  if (event.phase === 'error' || event.ok === false) {
    return '에러: ' + (event.error || 'unknown');
  }
  if (language === BOT_LANGUAGE.PY) {
    if (event.phase === 'loadingPyodide') return 'Python 로딩 중...';
    if (event.phase === 'loadingNumpy') return 'Python 준비 중... (numpy 로딩)';
    if (event.phase === 'runningSource') return '봇 코드 실행 중...';
  }
  return '';
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
 *   left: {modeGroup: Element, languageGroup: Element|null, source: HTMLTextAreaElement, exampleBtn: Element, status: Element},
 *   right: {modeGroup: Element, languageGroup: Element|null, source: HTMLTextAreaElement, exampleBtn: Element, status: Element},
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
    languageGroup: document.getElementById(`bot-setup-${side}-language`),
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
 * @return {{left: {mode: SideMode, source: string, language: SideLanguage}, right: {mode: SideMode, source: string, language: SideLanguage}}}
 */
function loadConfig() {
  const forSide = (side) => ({
    mode: localStorageWrapper.get(STORAGE_KEYS[side].mode) || DEFAULT_MODE,
    source: localStorageWrapper.get(STORAGE_KEYS[side].source) || '',
    language:
      localStorageWrapper.get(STORAGE_KEYS[side].language) || DEFAULT_LANGUAGE,
  });
  return { left: forSide('left'), right: forSide('right') };
}

/**
 * @param {{left: {mode: SideMode, source: string, language: SideLanguage}, right: {mode: SideMode, source: string, language: SideLanguage}}} config
 */
function saveConfig(config) {
  ['left', 'right'].forEach((side) => {
    localStorageWrapper.set(STORAGE_KEYS[side].mode, config[side].mode);
    localStorageWrapper.set(STORAGE_KEYS[side].source, config[side].source);
    localStorageWrapper.set(STORAGE_KEYS[side].language, config[side].language);
  });
}

/**
 * @param {ReturnType<typeof collectElements>} els
 * @param {{left: {mode: SideMode, source: string, language: SideLanguage}, right: {mode: SideMode, source: string, language: SideLanguage}}} config
 */
function populateUI(els, config) {
  els.left.source.value = config.left.source;
  els.right.source.value = config.right.source;
  setSelectedModeBtn(els, 'left', config.left.mode);
  setSelectedModeBtn(els, 'right', config.right.mode);
  setSelectedLanguageBtn(els, 'left', config.left.language);
  setSelectedLanguageBtn(els, 'right', config.right.language);
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
 * @param {SideLanguage} language
 */
function setSelectedLanguageBtn(els, side, language) {
  if (!els[side].languageGroup) return; // markup may be absent in some locales
  Array.from(els[side].languageGroup.children).forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.language === language);
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
