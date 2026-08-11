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
 * Phase 5 B refactor (loading pre-warm): PikaBotInput now lives across
 * intro/menu/round transitions of the same Apply. It is created (and its
 * Worker spawned + Pyodide loaded, if Python) at *Apply time*, blocked
 * behind a loading modal, so by the time the first round starts the
 * runtime is already warm and the bot reacts on frame 1. syncWithGameState
 * still swaps the input into/out of keyboardArray at round boundaries
 * (menu navigation still needs a real keyboard, ADR-0011), but no longer
 * destroys the input on the way out. Only a new Apply with a *different*
 * config (mode / language / source) tears the input down and rebuilds it.
 *
 * Design notes:
 * - "keyboard" mode is left completely alone (no isComputer/keyboardArray
 *   override) so the classic menu-driven 1P-vs-AI / 2P flow keeps working
 *   exactly as before for a side nobody touches here. Only "bot" and "ai"
 *   modes actively force isComputer and swap keyboardArray.
 * - Config only takes effect once a match's round actually starts (Apply
 *   calls pikaVolley.restart() *after* the pre-warm resolves, which sends
 *   the game back through intro -> menu -> ...). Swapping keyboardArray
 *   mid-round would risk leaving the physics engine in an inconsistent
 *   state.
 * - keyboardArray is continuously synced with the current game state (see
 *   syncWithGameState below): bot/AI slots are only installed while a
 *   match is actually in progress (round / afterEndOfRound /
 *   beforeStartOfNextRound), and swapped back to real keyboards the
 *   moment we leave that (back to intro/menu) so a human can navigate the
 *   next match's menu. Without this, once a match configured as
 *   bot-vs-bot ends, nothing would ever press powerHit to get through
 *   intro/menu again and the game would appear stuck
 *   (docs/agent-dev/decisions/ADR-0011-bot-setup-menu-navigation.md).
 * - Settings persist in localStorage (decision: keep across reloads) via
 *   the same localStorageWrapper the rest of the UI already uses.
 */
'use strict';
import { PikaKeyboard } from '../keyboard.js';
import { PikaBotInput } from './botInput.js';
import { NullInput } from './nullInput.js';
import { CHASE_BOT_SOURCE, CHASE_BOT_SOURCE_PY } from '../code/exampleBots.js';
import { BOT_LANGUAGE } from './botContract.js';
import { localStorageWrapper } from '../utils/local_storage_wrapper.js';

/** @typedef {'keyboard'|'bot'|'ai'} SideMode */
/** @typedef {'js'|'py'} SideLanguage */
/** @typedef {{mode: SideMode, source: string, language: SideLanguage}} SideConfig */

const DEFAULT_MODE = 'keyboard';
const DEFAULT_LANGUAGE = BOT_LANGUAGE.JS;

/**
 * Absolute ceiling on how long we'll keep the "환경 세팅 중" modal open
 * before giving up on a Worker's init. Pyodide + numpy typically resolves
 * in <10s; 60s is safety-net for a genuinely hung Worker so the user isn't
 * locked out of the panel forever.
 */
const INIT_TIMEOUT_MS = 60000;

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

  /**
   * PikaBotInputs currently owned by this module. Lifetime is
   * Apply-to-Apply, NOT match-to-match (see Phase 5 B refactor note in
   * file header). null when no bot mode is active for that side.
   * @type {{left: PikaBotInput|null, right: PikaBotInput|null}}
   */
  const activeBotInputs = { left: null, right: null };
  /**
   * The config that produced the current activeBotInputs. Used on next
   * Apply to decide which sides can be reused vs. must be torn down.
   * @type {{left: SideConfig, right: SideConfig}|null}
   */
  let appliedConfig = null;

  /** UI config -- what the panel currently shows, may differ from appliedConfig. */
  let config = loadConfig();
  populateUI(els, config);

  // See file header for match-boundary logic rationale.
  const isDuringMatch = () =>
    pikaVolley.state === pikaVolley.round ||
    pikaVolley.state === pikaVolley.afterEndOfRound ||
    pikaVolley.state === pikaVolley.beforeStartOfNextRound;

  // Tracks whether keyboardArray currently reflects appliedConfig (bot/AI
  // swapped in) vs plain keyboards (needed for menu navigation). Re-synced
  // every tick below rather than "once when Apply is clicked", so it keeps
  // correctly toggling across every match, not just the first one.
  let isConfigApplied = false;
  const syncWithGameState = () => {
    if (!appliedConfig) {
      // Nothing to sync until the user has clicked Apply at least once.
      return;
    }
    const duringMatch = isDuringMatch();
    if (duringMatch && !isConfigApplied) {
      installSide(pikaVolley, 'left', appliedConfig.left, activeBotInputs);
      installSide(pikaVolley, 'right', appliedConfig.right, activeBotInputs);
      isConfigApplied = true;
    } else if (!duringMatch && isConfigApplied) {
      uninstallForMenuNavigation(pikaVolley);
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
        setBotFieldsEnabled(els, side, btn.dataset.mode);
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

  els.applyBtn.addEventListener('click', async () => {
    const newConfig = {
      left: Object.assign({}, config.left, { source: els.left.source.value }),
      right: Object.assign({}, config.right, {
        source: els.right.source.value,
      }),
    };
    config = newConfig;
    saveConfig(newConfig);

    // Tear down any side whose config actually changed. Sides whose config
    // is identical to the last-applied one keep their PikaBotInput (and
    // its warm Pyodide/JS Worker), so re-Applying to tweak one side
    // doesn't pay the load cost on the other.
    ['left', 'right'].forEach((side) => {
      const prev = appliedConfig ? appliedConfig[side] : null;
      const next = newConfig[side];
      if (!sideConfigEqual(prev, next) && activeBotInputs[side] !== null) {
        activeBotInputs[side].destroy();
        activeBotInputs[side] = null;
      }
    });

    // Figure out which sides need a fresh bot input built now. Only "bot"
    // mode owns a PikaBotInput; "keyboard"/"ai" are installed inline in
    // installSide() at round-start time.
    const sidesToBuild = ['left', 'right'].filter(
      (side) => newConfig[side].mode === 'bot' && activeBotInputs[side] === null
    );

    if (sidesToBuild.length === 0) {
      // Nothing to load -- straight to restart.
      appliedConfig = newConfig;
      isConfigApplied = false; // force syncWithGameState to re-install on next round
      pikaVolley.restart();
      return;
    }

    // Something needs loading -- lock the panel and show progress modal.
    setInputsDisabled(els, true);
    showLoadingModal(els, sidesToBuild.length, newConfig);
    try {
      await Promise.all(
        sidesToBuild.map((side) =>
          createBotInputAsync(pikaVolley, side, newConfig[side], els).then(
            (input) => {
              activeBotInputs[side] = input;
            }
          )
        )
      );
    } finally {
      hideLoadingModal(els);
      setInputsDisabled(els, false);
    }

    appliedConfig = newConfig;
    isConfigApplied = false;
    pikaVolley.restart();
  });
}

/**
 * Build a PikaBotInput and resolve once its Worker has reached a terminal
 * init phase ('ok' or 'error'). Never rejects: the returned input is
 * usable even if init failed (it will emit neutral actions per D-002),
 * and the panel's status line already shows the error via onInitResult.
 *
 * A generous timeout guards against a Worker that never reports back at
 * all (e.g. a Pyodide download hang) so the modal doesn't lock the panel
 * forever.
 *
 * @param {import('../pikavolley.js').PikachuVolleyball} pikaVolley
 * @param {'left'|'right'} side
 * @param {SideConfig} sideConfig
 * @param {ReturnType<typeof collectElements>} els
 * @return {Promise<PikaBotInput>}
 */
function createBotInputAsync(pikaVolley, side, sideConfig, els) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ret) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolve(ret);
    };
    const timeoutHandle = setTimeout(() => {
      // Worker hung during init -- surface an error, resolve so the modal
      // closes, and let syncWithGameState install whatever we have. The
      // input's own timeout / restart machinery will pick up from there.
      setStatus(
        els,
        side,
        '에러: 초기화가 ' + INIT_TIMEOUT_MS / 1000 + '초 안에 끝나지 않음'
      );
      finish(input);
    }, INIT_TIMEOUT_MS);

    const input = new PikaBotInput({
      side: SIDE_INFO[side].engineSide,
      physics: pikaVolley.physics,
      getMeta: () => ({
        scores: pikaVolley.scores,
        isPlayer2Serve: pikaVolley.isPlayer2Serve,
      }),
      botSource: sideConfig.source,
      language: sideConfig.language,
      onInitResult: (event) => {
        setStatus(els, side, initPhaseToStatus(sideConfig.language, event));
        if (event.phase === 'ok' || event.phase === 'error') {
          finish(input);
        }
      },
    });

    setStatus(
      els,
      side,
      sideConfig.language === BOT_LANGUAGE.PY
        ? 'Python 러너 시작 중...'
        : '봇 로딩 중...'
    );
  });
}

/**
 * Install the already-prepared input for `side` into the game's
 * keyboardArray. Called by syncWithGameState the moment a match starts.
 * Nothing async here -- all the loading was done at Apply time.
 *
 * @param {import('../pikavolley.js').PikachuVolleyball} pikaVolley
 * @param {'left'|'right'} side
 * @param {SideConfig} sideConfig
 * @param {{left: PikaBotInput|null, right: PikaBotInput|null}} activeBotInputs
 */
function installSide(pikaVolley, side, sideConfig, activeBotInputs) {
  const { slotIndex, engineSide } = SIDE_INFO[side];
  const player =
    engineSide === 'LEFT'
      ? pikaVolley.physics.player1
      : pikaVolley.physics.player2;

  if (sideConfig.mode === 'keyboard') {
    if (!(pikaVolley.keyboardArray[slotIndex] instanceof PikaKeyboard)) {
      pikaVolley.keyboardArray[slotIndex] = createDefaultKeyboard(engineSide);
    }
    return;
  }

  if (sideConfig.mode === 'ai') {
    pikaVolley.keyboardArray[slotIndex] = new NullInput();
    player.isComputer = true;
    return;
  }

  // sideConfig.mode === 'bot' -- must have been prepared at Apply time.
  if (activeBotInputs[side] !== null) {
    player.isComputer = false;
    pikaVolley.keyboardArray[slotIndex] = activeBotInputs[side];
  }
  // else: shouldn't happen if Apply ran normally. Leaving the slot as-is
  // means the previous keyboard stays -- odd but not catastrophic.
}

/**
 * Swap real keyboards back into both slots for menu navigation. Unlike
 * the pre-B-refactor version, this does NOT destroy activeBotInputs --
 * they're kept warm so the next round starts instantly.
 * @param {import('../pikavolley.js').PikachuVolleyball} pikaVolley
 */
function uninstallForMenuNavigation(pikaVolley) {
  ['left', 'right'].forEach((side) => {
    const { slotIndex, engineSide } = SIDE_INFO[side];
    if (!(pikaVolley.keyboardArray[slotIndex] instanceof PikaKeyboard)) {
      pikaVolley.keyboardArray[slotIndex] = createDefaultKeyboard(engineSide);
    }
  });
}

/**
 * @param {SideConfig|null} a
 * @param {SideConfig|null} b
 */
function sideConfigEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.mode === b.mode && a.source === b.source && a.language === b.language
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
 * @param {ReturnType<typeof collectElements>} els
 * @param {number} sideCount how many sides are being loaded (for phrasing)
 * @param {{left: SideConfig, right: SideConfig}} newConfig
 */
function showLoadingModal(els, sideCount, newConfig) {
  if (!els.loadingBox) return;
  const anyPython = ['left', 'right'].some(
    (side) =>
      newConfig[side].mode === 'bot' &&
      newConfig[side].language === BOT_LANGUAGE.PY
  );
  if (els.loadingText) {
    els.loadingText.textContent = anyPython
      ? '봇 환경 세팅 중... Python 런타임 로딩이 몇 초 걸릴 수 있습니다.'
      : '봇 코드 로딩 중...';
  }
  els.loadingBox.classList.remove('hidden');
}

/**
 * @param {ReturnType<typeof collectElements>} els
 */
function hideLoadingModal(els) {
  if (!els.loadingBox) return;
  els.loadingBox.classList.add('hidden');
}

/**
 * Prevent double-clicking Apply / Close while a load is in flight.
 * @param {ReturnType<typeof collectElements>} els
 * @param {boolean} disabled
 */
function setInputsDisabled(els, disabled) {
  /** @type {HTMLButtonElement} */ (els.applyBtn).disabled = disabled;
  /** @type {HTMLButtonElement} */ (els.closeBtn).disabled = disabled;
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
 *   loadingBox: Element|null, loadingText: Element|null,
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
    loadingBox: document.getElementById('bot-loading-box'),
    loadingText: document.getElementById('bot-loading-text'),
    left: forSide('left'),
    right: forSide('right'),
  };
}

/**
 * @return {{left: SideConfig, right: SideConfig}}
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
 * @param {{left: SideConfig, right: SideConfig}} config
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
 * @param {{left: SideConfig, right: SideConfig}} config
 */
function populateUI(els, config) {
  els.left.source.value = config.left.source;
  els.right.source.value = config.right.source;
  setSelectedModeBtn(els, 'left', config.left.mode);
  setSelectedModeBtn(els, 'right', config.right.mode);
  setSelectedLanguageBtn(els, 'left', config.left.language);
  setSelectedLanguageBtn(els, 'right', config.right.language);
  setBotFieldsEnabled(els, 'left', config.left.mode);
  setBotFieldsEnabled(els, 'right', config.right.mode);
}

/**
 * Enable the language buttons, source textarea, and example button only for
 * "bot" mode; disable them for "keyboard"/"ai" so it's visually obvious those
 * fields are irrelevant. `button:disabled` in style.css already grays out the
 * buttons; textarea gets its subtle fade from .bot-setup-textarea:disabled.
 * @param {ReturnType<typeof collectElements>} els
 * @param {'left'|'right'} side
 * @param {SideMode} mode
 */
function setBotFieldsEnabled(els, side, mode) {
  const enabled = mode === 'bot';
  const sideEls = els[side];
  sideEls.source.disabled = !enabled;
  sideEls.exampleBtn.disabled = !enabled;
  if (sideEls.languageGroup) {
    Array.from(sideEls.languageGroup.children).forEach((btn) => {
      btn.disabled = !enabled;
    });
  }
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
