# 03. 봇(참가자 코드) 입력 통합 — 원본 대비 수정 사항

> 이전 문서: [02-input-keyboard.md](./02-input-keyboard.md) · 목차: [00-overview.md](./00-overview.md)
>
> 00~02번 문서가 원작(수정 전) 구조를 설명한다면, 이 문서는 **그 구조를 기반으로 실제로 무엇을
> 어디에 추가/수정했는지**를 다룬다. 대회 협업 프로세스(브랜치 전략, ADR 절차 등)는 이 문서 범위
> 밖이며 [AGENTS.md](../../AGENTS.md)를 참고할 것. 프로토콜의 전체 스펙/설계 근거는
> [docs/agent-dev/CONTRACTS.md](../agent-dev/CONTRACTS.md)가 단일 진실 소스(SOR)이고, 이 문서는
> "원본 코드 대비 뭐가 바뀌었는지"를 코드 위치 중심으로 요약한 것이다.

## 0. 핵심 요약: 원본 엔진 파일은 한 줄도 안 바뀜

[physics.js](../../src/resources/js/physics.js), [pikavolley.js](../../src/resources/js/pikavolley.js),
[keyboard.js](../../src/resources/js/keyboard.js) — 00~02번 문서가 설명한 Model/Controller/키입력
파일은 **전부 무수정**이다 (`git diff` 확인). 실제로 바뀐 건:

- [main.js](../../src/resources/js/main.js) 딱 2줄 ([L46](../../src/resources/js/main.js#L46) import, [L148](../../src/resources/js/main.js#L148) 호출)
- 신규 디렉토리 [src/resources/js/bot/](../../src/resources/js/bot/) 6개 파일
- 언어별 `index.html` + `style.css`에 "Bot Setup" 패널 UI 마크업/스타일 추가 (게임 로직과 무관, 이 문서에서 상세히 다루지 않음)

이게 가능한 이유는 [AGENTS.md](../../AGENTS.md) §2가 짚은 확장 지점 그대로다: `physics.runEngineForNextFrame`은
`keyboardArray` 원소가 `getInput()` 호출 후 `xDirection`/`yDirection`/`powerHit` 세 필드만 채워주면
그게 키보드든 봇이든 신경 쓰지 않는다. 그래서 봇 기능 전체를 **엔진 파일을 건드리지 않고** `PikaUserInput`
([physics.js:102](../../src/resources/js/physics.js#L102))을 상속하는 새 클래스 + 그 클래스를
`keyboardArray`에 꽂아주는 조립 코드만으로 구현했다.

## 1. 새로운 입력 경로

원본 경로(02번 문서)와 비교:

| | 원본 | 봇 경로 |
|---|---|---|
| 입력 소스 | `window` keydown/keyup | Web Worker 안에서 실행되는 봇 코드의 `decide()` 반환값 |
| 클래스 | `PikaKeyboard` ([keyboard.js:10](../../src/resources/js/keyboard.js#L10)) | `PikaBotInput` ([bot/botInput.js:23](../../src/resources/js/bot/botInput.js#L23)) |
| `keyboardArray`에 꽂히는 방식 | `pikavolley.js` 생성자에서 고정 | [testSetup.js](../../src/resources/js/bot/testSetup.js)가 UI 설정에 따라 런타임에 슬롯 교체 (3절) |
| `getInput()` 호출 주체/시점 | `gameLoop()`, 변경 없음 | 동일 — `gameLoop()`은 `keyboardArray[i]`가 뭔지 모른다 |

`PikaBotInput`도 `PikaUserInput`을 상속하므로 `gameLoop()`의
[`this.keyboardArray[0].getInput()` / `[1].getInput()`](../../src/resources/js/pikavolley.js#L137-L138) 호출
자체는 원본과 동일하게 매 틱 일어난다. 다만 내부 동작이 다르다
([bot/botInput.js:154-196](../../src/resources/js/bot/botInput.js#L154-L196) `getInput()`):

1. 이번 틱엔 **가장 최근에 이미 도착해 있던** 봇 응답(`this.latestAction`)을 그대로 `xDirection`/`yDirection`/`powerHit`에 반영한다.
2. `tick % TICK_FRAME_GROUP_SIZE === 0`이고 이전 요청이 아직 안 끝났으면, 다음 스냅샷을 만들어 Worker에 `postMessage`로 **비동기** 전송한다 (응답은 나중에 `handleWorkerMessage`가 처리).

브라우저 메인 스레드는 Worker 응답을 그 틱 안에서 동기적으로 기다릴 수 없기 때문에(`Atomics.wait`은
Worker 전용), 이 구조상 봇의 반응에는 항상 약 1틱(`TICK_FRAME_GROUP_SIZE=1`이면 ~40ms) 파이프라인
지연이 있다. 원본 키보드 입력에는 없던 특성으로, 버그가 아니라 설계상 트레이드오프다.

봇을 아예 안 쓰는 슬롯(예: 기본 내장 AI만 쓰는 진영)에는 아무 값도 만들지 않는
[`NullInput`](../../src/resources/js/bot/nullInput.js)이 대신 꽂힌다 — `player.isComputer === true`일
때는 원본 그대로 `physics.js`의 `letComputerDecideUserInput`이 그 틱의 `userInput`을 직접 덮어쓰므로
([physics.js:502-504](../../src/resources/js/physics.js#L502-L504), 01번 문서 3.3절), 이 슬롯은 `getInput()`
메서드가 존재하기만 하면 된다.

## 2. 게임 상태 스냅샷 API (엔진 → 봇)

스냅샷 생성은 순수 함수 `buildGameStateSnapshot()` 하나로 통일되어 있다
([bot/botContract.js:85-129](../../src/resources/js/bot/botContract.js#L85-L129)) — `physics`/`meta` 객체를
읽기만 하고 아무것도 바꾸지 않는다. 호출 지점은 `PikaBotInput.getInput()` 내부, 위 1절의 2번 시점
([botInput.js:178-184](../../src/resources/js/bot/botInput.js#L178-L184)).

필드는 엔진 값 + 엔진 밖 스킬 계층 값이고, 봇 편의를 위해 새로 계산해 지어낸 값은 없다:

| 스냅샷 필드 | 출처 (physics.js) |
|---|---|
| `self`/`opp`.`x`/`y`/`state`/`frameNumber`/`divingDirection`/`lyingDownDurationLeft` | `Player` 인스턴스 필드 그대로 ([physics.js:124](../../src/resources/js/physics.js#L124)) |
| `self`/`opp`.`gauge`, `self`/`opp`.`claw`, `config.gauge`, `config.claw` | 엔진이 아니라 **스킬 계층**([skill/setup.js](../../src/resources/js/skill/setup.js)의 `getSkillState`)이 주입한다. 인덱스(player1/player2) 기준으로 들어와서 빌더가 `self`/`opp`로 뒤집는다 (D-023) |
| `ball.x`/`y`/`xVelocity`/`yVelocity`/`isPowerHit` | `Ball` 인스턴스 필드 그대로 ([physics.js:226](../../src/resources/js/physics.js#L226)) |
| `ball.expectedLandingPointX` | 엔진이 매 프레임 이미 계산해두는 값, 기본 AI도 이걸로 판단함 ([physics.js:323](../../src/resources/js/physics.js#L323), [physics.js:808-857](../../src/resources/js/physics.js#L808-L857)) |
| `meta.score` / `meta.isPlayer2Serve` | `pikavolley.js`의 `this.scores` / `this.isPlayer2Serve` (원본 필드, 변경 없음) |
| `meta.rallyFrameCount` | `PikaBotInput`이 자체적으로 세는 값 — 스코어 합계가 바뀌면 리셋 ([botInput.js:160-166](../../src/resources/js/bot/botInput.js#L160-L166)) |

좌표계는 변환 없이 원본 정수 픽셀 그대로다 (좌상단 원점, y는 아래로 증가 — 02번 문서와 동일 규약).
관련 상수(`GROUND_WIDTH`, `NET_PILLAR_HALF_WIDTH` 등)는 [botContract.js:12-21](../../src/resources/js/bot/botContract.js#L12-L21)에
물리엔진 값과 동일하게 재정의되어 있다.

봇 → 엔진 방향은 반대로 단순하다: 봇은 `{ x, y, hit }`만 반환하고, 이 세 값이 각각
`PikaUserInput.xDirection`/`yDirection`/`powerHit`에 1:1로 매핑된다 (`isValidBotAction()`,
[botContract.js:60-67](../../src/resources/js/bot/botContract.js#L60-L67)). 타임아웃이거나 형식이 잘못된
응답은 무입력(`NEUTRAL_ACTION`, [botContract.js:53](../../src/resources/js/bot/botContract.js#L53))으로
처리되고 "이전 값 유지" 같은 건 하지 않는다.

## 3. 봇 실행 격리 (Web Worker)

봇 코드는 메인 스레드에서 직접 돌리지 않고 [bot/botWorker.js](../../src/resources/js/bot/botWorker.js)가
전담하는 별도 Worker에서 실행된다. `init` 메시지로 봇 소스 문자열을 받으면
`new Function(source + "; return decide;")`로 `decide()` 함수만 추출해 저장하고
([botWorker.js:31-35](../../src/resources/js/bot/botWorker.js#L31-L35)), 이후 매 `tick` 메시지마다 그
함수를 스냅샷과 함께 호출해 결과를 `postMessage`로 돌려준다. `eval` 대신 `Function`을 쓴 건 이
클로저의 지역변수가 봇 코드에 새어 들어가지 않게 하기 위함이다.

이 격리의 목적은 강한 보안 샌드박싱이 아니라 **봇 코드의 무한루프/과부하가 메인 스레드(렌더링 +
상대방 입력 포함)까지 멈추는 걸 막는 것**이다. `PikaBotInput` 쪽에서 요청마다 `requestId`를 붙여
지연 응답이 최신 상태를 덮어쓰지 않게 막고, 타임아웃이 연속으로 쌓이면
(`MAX_CONSECUTIVE_TIMEOUTS_BEFORE_RESTART`, [botContract.js:46-50](../../src/resources/js/bot/botContract.js#L46-L50))
`spawnWorker()`로 Worker를 강제 재시작한다 ([botInput.js:127-140](../../src/resources/js/bot/botInput.js#L127-L140)).

## 4. 그 외 게임 진행 관련 수정

### 4.1 이 로직이 왜 필요한가

Bot Setup 패널([testSetup.js](../../src/resources/js/bot/testSetup.js))은 왼쪽/오른쪽 진영을 각각
독립적으로 "키보드 / 봇 코드 / 기본 AI" 세 모드 중 하나로 고를 수 있게 해준다. 이 설정을
`keyboardArray`에 반영하는 방법으로 가장 단순하게 떠올릴 수 있는 건 "Apply 버튼을 누르는 순간
`keyboardArray`를 딱 한 번 교체한다"일 텐데, 이러면 두 가지가 깨진다.

1. **Apply를 누른 시점에 게임이 인트로/메뉴 화면일 수 있다.** 인트로("파워히트로 스킵")와
   메뉴("1P/2P 선택")는 사람이 실제 키를 눌러야 다음 화면으로 넘어가는데, 이 시점에 이미
   `keyboardArray`를 봇으로 바꿔버리면 그 진영은 더 이상 물리 키 입력을 받지 않으니 아무도 메뉴를
   진행시킬 수 없다.
2. **경기가 끝나고 다시 인트로로 돌아왔을 때도 문제다.** 인트로/메뉴 화면에서는
   `physics.runEngineForNextFrame`이 아예 호출되지 않는다(01번 문서 3.1절) — 즉 공/플레이어 좌표가
   갱신되지 않고 직전 경기 종료 시점 값에 멈춰 있다. 봇의 `decide()`는 이 멈춰있는 스냅샷을 보고
   매 틱 똑같은 값을 반환할 뿐이고, "여기는 메뉴 화면이니 확인 키를 눌러야 한다"는 개념 자체가
   없다. 한 번 봇으로 바꾼 뒤 되돌리는 로직이 없다면, 경기가 끝나고 인트로로 돌아와도 그 진영은
   계속 봇이 (내비게이션에는 무의미한) 입력을 내고 있는 채로 멈춰버린다.

즉 "언제 봇으로 바꿀지"뿐 아니라 "언제 다시 사람 키보드로 되돌려놓을지"까지 게임 상태에 맞춰
계속 챙겨줘야 한다.

### 4.2 실제 동작: 매 틱 감시, 상태 전이 시점에만 교체

`testSetup.js`는 원본 상태머신(01번 문서 2절)의 전이 규칙 자체는 전혀 건드리지 않는다. 대신
`ticker.add()`로 등록한 `syncWithGameState()`가 매 틱 `pikaVolley.state`가 지금 "경기 진행 중"인지를
확인하고, 그 결과가 직전 틱과 달라지는 **경계에서만** `keyboardArray`를 교체한다
([testSetup.js:88-110](../../src/resources/js/bot/testSetup.js#L88-L110)):

- "경기 진행 중"의 기준은 `round` / `afterEndOfRound` / `beforeStartOfNextRound` 세 상태다 —
  한 경기 안에서 랠리가 끝나고 다음 랠리를 준비하는 전환까지 포함해서 계속 봇/AI를 유지하되,
  경기 자체가 끝나는 게 아니라는 뜻이다 (`isDuringMatch()`, [testSetup.js:88-91](../../src/resources/js/bot/testSetup.js#L88-L91)).
- 매 틱 실제로 `keyboardArray`를 다시 쓰지는 않는다. `isConfigApplied` 플래그로 "지금 봇/AI가
  적용된 상태인지"를 기억해두고, 값이 바뀔 때(꺼짐→켜짐, 켜짐→꺼짐) 딱 한 번씩만 교체 작업을
  수행한다. 그래서 "매 틱 관찰"이라고 해서 매 틱 `keyboardArray`를 새로 만드는 건 아니고, 감시만
  매 틱 하고 실제 교체는 상태가 바뀌는 순간에만 일어난다.

아래는 왼쪽=봇, 오른쪽=기본AI로 설정하고 Apply를 눌렀을 때 실제로 벌어지는 흐름 예시다:

| 시점 | `pikaVolley.state` | `isDuringMatch()` | `keyboardArray`에 실제로 들어있는 것 |
|---|---|---|---|
| 페이지 로드 직후 | `intro` | false | 양쪽 다 실제 `PikaKeyboard` (사람이 스킵 가능) |
| Apply 클릭 → `restart()` 호출 | `intro`로 리셋 | false | 아직 그대로 `PikaKeyboard` — 사람이 메뉴까지 직접 진행해야 함 |
| 메뉴에서 선택 후 `round` 진입 | `round` | **false→true 전환** | `syncWithGameState`가 감지 → `applySide()` 실행 → 왼쪽은 `PikaBotInput`, 오른쪽은 `NullInput` + `player2.isComputer = true`로 교체 ([testSetup.js:159-203](../../src/resources/js/bot/testSetup.js#L159-L203)) |
| 랠리 종료 → `afterEndOfRound` → `beforeStartOfNextRound` → 다음 랠리 `round` | 계속 "경기 진행 중" 그룹 안에서 이동 | true 유지 | 변화 없음 (이미 `isConfigApplied === true`라 재교체 스킵) |
| 누군가 15점 달성, 경기 종료 → `intro`로 복귀 | `intro` | **true→false 전환** | `restoreKeyboardsForMenuNavigation()` 실행 → 양쪽 다 다시 실제 `PikaKeyboard`로 교체 ([testSetup.js:219-227](../../src/resources/js/bot/testSetup.js#L219-L227)) — 이제 사람이 다음 경기 메뉴를 조작할 수 있음 |
| 다음 경기 메뉴 선택 → `round` 재진입 | `round` | **false→true 전환** | 저장된 config 그대로 다시 `applySide()` 실행 — 왼쪽 봇/오른쪽 AI 재적용 |

"키보드" 모드로 설정된 진영은 애초에 `applySide()`가 아무것도 교체하지 않으므로
([testSetup.js:166-175](../../src/resources/js/bot/testSetup.js#L166-L175)) 이 로직의 영향을 받지 않고
메뉴에서 고른 1P/2P 그대로 원본 흐름을 탄다.

정리하면: **게임 진행(상태머신)의 전이 규칙 자체는 바뀌지 않았고**, `keyboardArray`에 매 순간
무엇이 꽂혀 있는지만 이 감시 로직이 경기 시작/종료 경계마다 자동으로 바꿔치기해준다.

## 5. 신규 파일 지도

| 파일 | 역할 |
|---|---|
| [bot/botContract.js](../../src/resources/js/bot/botContract.js) | 프로토콜 상수 + 스냅샷 빌더 (SOR: [CONTRACTS.md](../agent-dev/CONTRACTS.md)) |
| [bot/botInput.js](../../src/resources/js/bot/botInput.js) | `PikaBotInput` — `PikaUserInput`을 상속하는 봇용 입력 클래스 |
| [bot/botWorker.js](../../src/resources/js/bot/botWorker.js) | Worker 쪽에서 봇 코드를 로드/실행하는 실행기 |
| [bot/nullInput.js](../../src/resources/js/bot/nullInput.js) | 기본 AI 진영용 무입력 플레이스홀더 |
| [bot/exampleBots.js](../../src/resources/js/bot/exampleBots.js) | Bot Setup 패널의 "예시 코드 채우기" 버튼용 샘플 봇 소스 |
| [bot/testSetup.js](../../src/resources/js/bot/testSetup.js) | 좌우 진영을 키보드/봇/기본AI로 설정하는 UI + `keyboardArray` 동기화 로직 |
