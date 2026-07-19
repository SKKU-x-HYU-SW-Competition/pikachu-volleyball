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

**상태**: **완료 (1차 구현 + 브라우저 검증됨)**. 남은 건 Phase 2에서 `devBotHook.js`를 실제 UI로 교체하는 것.

---

## Phase 2 — 테스트 환경

**목표**: 참가자가 대회 준비 기간과 현장에서 **(a) 자기 에이전트 코드 vs 자기 키보드 입력**,
**(b) 자기 에이전트 코드 vs 기본 탑재 AI**로 즉시 붙어볼 수 있는 환경. 코드 수정 → 결과 확인
루프를 자주 돌릴 것이므로 UX가 최우선.

**의존성**: Phase 1 완료 필요 (에이전트를 꽂을 자리가 있어야 함).

**단계**:
1. `stub 확정`: 에이전트 코드를 로드하는 방식(파일 선택 업로드 / 코드 붙여넣기 / 로컬 파일 감시) 중 무엇을 쓸지, player1/player2 각각 [키보드 | 기본 AI | 내 에이전트]를 선택하는 UI 형태를 확정.
2. `codegen`: 로더 + 선택 UI 뼈대.
3. `구현`: 실제 동작 + 에러 처리(에이전트 코드가 예외를 던지면 게임이 멈추지 않게).

**상태**: 미착수

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

**단계**: 아직 stub도 확정 전. 착수 시점에 이 섹션을 채우세요.

**상태**: 미착수
