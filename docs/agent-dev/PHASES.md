# PHASES.md — 트랙별 Phase 계획

각 Phase는 **stub 확정 → codegen → 구현** 순서로 진행합니다. 인터페이스(스텁)를 먼저 못박아서
[CONTRACTS.md](CONTRACTS.md)에 반영하고, 그 스텁을 기준으로 뼈대 코드를 만든 뒤에 실제 로직을
채우는 순서를 지키세요 — 순서를 건너뛰면 트랙 간(특히 서로 다른 사람이 맡은 트랙 간) 인터페이스가
어긋나는 race가 납니다.

순서: **① 입력 구조 개편 → ③ 테스트 환경 → ④ 제출/중계 → ② 스킬/에셋** (근거: 입력 구조가 나머지
세 트랙 모두의 전제이고, 테스트 환경은 참가자가 대회 준비 기간 내내 쓸 것이라 제출/중계보다 먼저
다듬어야 하며, 제출/중계 인프라는 대회 임박 시점에 확정해도 되므로 뒤로 미룸. 스킬/에셋은 원래도 후순위).

각 Phase 항목의 `상태`는 `미착수 / stub 확정 중 / codegen / 구현 중 / 완료` 중 하나로 직접 갱신하세요.

---

## Phase 1 — 입력 구조 개편

**목표**: `PikaUserInput`을 상속하는 새 입력 클래스(`PikaBotInput`)를 만들어, 참가자가 제출한
"매 틱 입력을 결정하는 코드 조각"을 게임 시작 전에 등록해두고, 그 코드가 매 틱 호출되어
`xDirection`/`yDirection`/`powerHit`를 채우도록 만든다. 사람이 키보드로 조작하는 기존 `PikaKeyboard`와
동일한 자리(`keyboardArray`)에 꽂을 수 있어야 한다.

**관련 파일**: [`keyboard.js`](../../src/resources/js/keyboard.js) (참고 구현),
[`physics.js:102`](../../src/resources/js/physics.js#L102) (`PikaUserInput` 베이스),
[`pikavolley.js:42-51`](../../src/resources/js/pikavolley.js#L42-L51) (`keyboardArray` 생성부),
[`pikavolley.js:120-140`](../../src/resources/js/pikavolley.js#L120-L140) (`gameLoop`, 매 틱 `getInput()` 호출부).

**단계**:
1. `stub 확정`: [CONTRACTS.md](CONTRACTS.md) §1(입출력 프로토콜), §2(틱 타이밍)를 팀 리뷰에서 확정. **완료** — D-001~D-003, D-006~D-009 모두 RESOLVED.
2. `codegen` → `구현`: 스냅샷 빌더, `PikaBotInput`(Worker 격리 + 타임아웃/무입력 폴백 + 강제 재시작), Worker 쪽 실행기까지 한 번에 구현. **완료**:
   - [`bot/botContract.js`](../../src/resources/js/bot/botContract.js) — 상수 + `buildGameStateSnapshot` + `isValidBotAction`
   - [`bot/botWorker.js`](../../src/resources/js/bot/botWorker.js) — Worker 쪽 봇 실행기
   - [`bot/botInput.js`](../../src/resources/js/bot/botInput.js) — `PikaBotInput` (`PikaUserInput` 상속, `keyboardArray` 원소로 그대로 교체 가능)
   - `keyboardArray`에 꽂는 배선: [`bot/devBotHook.js`](../../src/resources/js/bot/devBotHook.js) — **임시** 쿼리 파라미터(`?bot=left|right|both`) 기반 훅. Phase 2가 진짜 선택 UI를 만들면 이 파일은 지우고 그 UI가 같은 방식(`keyboardArray[i] = new PikaBotInput(...)`)으로 교체하면 됨.
3. **검증**: `npm run lint`/`npm run build` 통과 확인 + Playwright로 실제 브라우저에서 `?bot=right`로 기동, 메뉴에서 "with friend" 선택 후 라운드 진입, `player2.isComputer === false` 및 `player2.x/state`가 시간에 따라 변하는 것(체이스 → 점프 → 파워히트, state 0→1→2)을 실측 확인, 콘솔 에러 없음 확인. 스크린샷으로 실제 파워히트 이펙트까지 시각 확인.

**상태**: **완료 (1차 구현 + 브라우저 검증됨)**. `devBotHook.js`는 Phase 2에서 실제 UI(`testSetup.js`)로
교체되어 삭제됨.

---

## Phase 2 — 테스트 환경

**목표**: 참가자가 대회 준비 기간과 현장에서 좌/우 진영을 각각 자유롭게
**[키보드 | 내 봇 코드 | 기본 탑재 AI]** 중 하나로 정해서 어떤 조합으로도 붙어볼 수 있는 환경
(봇 vs 내 키보드, 봇 vs 기본 AI, 봇 vs 봇 등). 코드 수정 → 결과 확인 루프를 자주 돌릴 것이므로
UX가 최우선.

**의존성**: Phase 1 완료 필요 (봇을 꽂을 자리가 있어야 함) — 충족됨.

**결정**: 봇 코드는 텍스트 붙여넣기(파일 업로드 아님), 설정 변경은 "적용" 클릭 시 `restart()`로만
반영(핫스왑 아님), 설정은 localStorage에 저장(새로고침해도 유지) — 세 가지 모두 사용자 승인.

**단계**:
1. `stub 확정`: 위 결정대로 확정.
2. `codegen` → `구현`: 한 번에 구현. 결과물:
   - [`bot/nullInput.js`](../../src/resources/js/bot/nullInput.js) — "기본 AI" 슬롯용 no-op 입력
     (엔진이 `isComputer===true`일 때 입력을 통째로 덮어쓰므로 실제 값은 필요 없음)
   - [`bot/testSetup.js`](../../src/resources/js/bot/testSetup.js) — 좌우 3-way 모드 선택,
     localStorage 저장/복원, "적용 시 재시작 후 다음 라운드 시작 시점에 배선" 패턴(Phase 1의
     `devBotHook.js`와 동일 기법, 재사용 가능하게 일반화)
   - `bot/botInput.js`에 `onInitResult` 콜백 추가 — 봇 코드 문법 오류 등을 패널에 상태로 표시
     (`봇 코드 로드됨` / `에러: ...`)
   - `en/ko/zh index.html` + `style.css` — "Bot Setup" 패널 (메뉴바 버튼 + fade-in-box, textarea
     2개, 모드 선택 버튼 6개, 예제 불러오기, 적용/닫기)
   - 패널 내부에서 타이핑한 키(z/d/g/r/v/f 등)가 게임 키 입력으로 새는 걸 막기 위해
     `keydown`/`keyup`에 `stopPropagation()` 적용
   - `devBotHook.js` 삭제 (역할을 `testSetup.js`가 대체)
3. **검증**: `npm run lint`/`npm run build` 통과. Playwright로 세 조합
   (키보드 vs 봇, 기본AI vs 봇, 봇 vs 봇) 실제 브라우저에서 각각 라운드 진입 후
   `isComputer` 플래그와 좌표가 기대대로 나오는지, 상태 표시가 정상인지 확인. localStorage
   저장/복원(새로고침 후 패널을 안 만져도 이전 설정이 자동 재적용되는지)도 별도 확인.
   구현 중 발견한 버그는 [DECISIONS.md](DECISIONS.md) D-010 참고.

**상태**: **완료 (1차 구현 + 브라우저 검증됨)**

---

## Phase 3 — 제출 / 중계

**목표**: 참가자가 완성한 에이전트 코드를 제출하면, 중계 컴퓨터에서 그 코드를 불러와 실행하고
경기를 관전 가능한 형태로 보여준다.

**의존성**: Phase 1, Phase 2 완료 필요 (제출된 코드도 결국 같은 에이전트 인터페이스로 로드됨).

**단계**:
1. `stub 확정`: 제출 포맷(파일 1개? 함수 시그니처?), 제출 채널(메일 fallback 포함 — [DECISIONS.md](DECISIONS.md) D-004), 로딩 방식(동적 import 시 보안/샌드박싱 필요 여부 — D-003과 연결)을 확정.
2. `codegen`: 제출물 로더 + 중계 화면(스코어보드/대진) 뼈대.
3. `구현`: 실제 로딩·실행·중계 파이프라인.

**상태**: 미착수

---

## Phase 4 — 스킬 추가 & 에셋 교체 (후순위)

**목표**: 새로운 스킬(필살기, 게이지 등) 추가. 대회 현장에 맞게 배경/현수막 등 이미지 교체.

**의존성**: Phase 1 완료 후 착수 권장 (입력/상태 구조가 바뀌면 스킬이 훅을 거는 지점도 함께 바뀜).
현장에서 참가자에게 "새 스킬 공개"하는 이벤트와 맞물리므로 대회 일정에 맞춰 타이밍 조정 필요.

**단계**:

- **A. 게이지(스킬 자원)** — 스킬을 "무엇으로 사는지"를 먼저 확정. 충전 규칙/범위/리셋 시점만
  정하고 스킬 효과는 건드리지 않는다. 게이지 증감 곡선을 실제 경기에서 눈으로 확인하고 밸런스를
  잡은 뒤 B로 넘어간다 ([ADR-0020](decisions/ADR-0020-gauge-system.md)).
- **B. 스킬 효과 + 발동** — 스킬 종류와 각 소모량, 사람 플레이어의 발동 키, 봇 프로토콜 확장
  (스냅샷에 `gauge` 노출 + 발동 필드). 여기서부터 `physics.js` 수정(Tier B)이 필요할 수 있고,
  [CONTRACTS.md](CONTRACTS.md) 버전업 + 기존 참가자 봇과의 하위 호환 검토가 함께 필요하다.
  - **B-1 「claw」 1차 구현 완료** (Issue #10, [ADR-0021](decisions/ADR-0021-claw-skill.md),
    [ADR-0022](decisions/ADR-0022-bot-skill-action-field.md)): 게이지 50 소모 →
    x범위 예고 1초 → 발톱 생성 → 범위 안 상대 1초 기절(공중이면 즉시 착지). 엔진의 누움
    상태(`state === 4`)를 밖에서 세팅하는 방식이라 **여기서도 `physics.js` 무수정(Tier A)** 이었다.
    판정은 지정한 x범위 안의 **모든 y**라 점프로는 못 피하고 좌우 이동만이 회피 수단이다.
    **봇은 액션 필드 `skillX`로 x를 직접 지정**하고([ADR-0022](decisions/ADR-0022-bot-skill-action-field.md),
    CONTRACTS.md v0.6), 키보드 발동은 좌표 입력 수단이 없어 상대 위치 중심을 쓴다. 기본 탑재 AI는
    스킬을 쓰지 못한다.
  - **B-2 스냅샷 확장 (미착수)**: 스냅샷에 자기/상대 `gauge`와 예고 중인 발톱 범위 노출.
    **이게 없으면 봇은 발동만 가능하고 회피가 구조적으로 불가능**하므로, 그때까지 봇 대전 밸런스
    판단은 보류한다. CONTRACTS.md 추가 버전업 대상.
- **C. 에셋 교체** — 배경/현수막 등 이미지. A/B와 독립적이라 언제든 가능. RATIO 배선과 펭수배구
  스프라이트 교체가 여기에 해당하며 이미 `develop`에 머지됐다
  ([ADR-0019](decisions/ADR-0019-asset-resolution-ratio.md)).

**작업 브랜치**: A 이후의 스킬 작업(B)은 `develop`이 아니라 **`develop-skill`**에서 진행한다
(팀장 결정, [AGENTS.md](../../AGENTS.md) §5). 게이지(A)도 `develop-skill`에 들어가 있다.

**상태**: **A 구현 완료, B-1(claw) 구현 완료·B-2(봇 프로토콜) 미착수, C 일부 완료**. A는 엔진 파일
무수정으로 구현됐다 (`player.isCollisionWithBallHappened`를 엔진 밖에서 매 틱 관찰 —
[05-skill-extension-guide.md](../architecture/05-skill-extension-guide.md) 분류상 Tier A).
B의 미결 사항은 ADR-0020에 OPEN으로 등재되어 있으며 **정기 회의 안건**이다.

> **순서 참고**: 위 순서표상 Phase 3(제출/중계)가 먼저지만, 팀장 판단으로 Phase 4를 먼저 착수했다.
> Phase 4의 의존성("Phase 1 완료 후")은 충족된 상태이고, 게이지 밸런스는 실제 경기를 여러 번
> 돌려봐야 감이 잡히므로 대회 준비 기간 중 일찍 시작하는 편이 낫다는 판단. Phase 3는 여전히
> 미착수이며 순서를 뒤집은 것이지 취소한 것이 아니다.

---

## Phase 5 — 다국어 봇 지원 (Python 우선)

**목표**: 지금까지 JS로만 짤 수 있던 봇을 **Python**(1차)과 **C/C++**(향후)로도 짤 수 있게
확장한다. 브라우저 내 WASM 방식([ADR-0012](decisions/ADR-0012-multi-language-bot-support.md))으로,
현재의 Web Worker 격리/스냅샷 프로토콜은 그대로 유지하고 Worker 내부에서 돌아가는 러너만
언어별로 갈아 끼운다. 이 브랜치(`python`)에서는 **Python만** 다룬다 — C/C++는 별도 브랜치/ADR로.

**의존성**: Phase 1, Phase 2 완료 필요 (봇 프로토콜과 Bot Setup UI가 확장 대상).

**관련 결정**:
[ADR-0012](decisions/ADR-0012-multi-language-bot-support.md)(브라우저 내 WASM),
[ADR-0013](decisions/ADR-0013-python-decide-signature.md)(Python `decide` 시그니처),
[ADR-0014](decisions/ADR-0014-pyodide-distribution.md)(Pyodide 정적 복사),
[ADR-0015](decisions/ADR-0015-pyodide-load-timing.md)(Python 선택 시 지연 로드),
[ADR-0016](decisions/ADR-0016-tick-frame-group-size-raised.md)(TICK_FRAME_GROUP_SIZE 1→3),
[ADR-0017](decisions/ADR-0017-python-execution-failure.md)(Python 실패 처리),
[ADR-0018](decisions/ADR-0018-python-library-scope.md)(표준 라이브러리 + numpy).

**단계**:
1. `stub 확정`: 위 7개 ADR 팀장 결재 + [CONTRACTS.md](CONTRACTS.md) v0.5 갱신(§1.3에 언어별 러너
   개념, §1.4 Python 진입점 시그니처, §2 TICK_FRAME_GROUP_SIZE 상향). **완료**.
2. `codegen` → `구현`:
   - `TICK_FRAME_GROUP_SIZE` 상향(`bot/botContract.js`) + JS 봇 회귀 확인
   - Pyodide 정적 자산 배치(`npm i pyodide` + `copy-webpack-plugin`으로 `dist/pyodide/`) + webpack 통합
   - `bot/botContract.js`에 `BOT_LANGUAGE` enum + 검증 함수 추가
   - `bot/botWorkerPython.js` 신설 — Pyodide 로드 + `pyodide.loadPackage('numpy')` + 참가자 소스
     실행 + `decide` 심볼 매 틱 호출
   - `bot/botInput.js` `PikaBotInput`에 `language` 파라미터 추가 → `spawnWorker()`가 언어별 Worker
     URL 선택
   - `bot/testSetup.js`에 side별 언어 선택 UI 반영 + `onInitResult` 진행 단계 표시
   - `en/ko/zh index.html` + `style.css`에 언어 선택 UI 마크업
   - `bot/examplePythonBots.js` — 추격형 봇의 Python 포팅
3. **검증**: `npm run lint`/`npm run build` 통과. Playwright로 (a) JS 봇 회귀 (b) Python vs JS
   (c) Python vs Python (d) Python 초기 로드 UX(상태 문구 진행) 확인. 콘솔 에러 없음.

**상태**: 진행 중 (stub 확정 완료, 구현 착수 전)
