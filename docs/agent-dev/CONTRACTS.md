# CONTRACTS.md — 봇 입출력 프로토콜 & 틱 타이밍 (SOR)

> **상태: DRAFT v0.7 — Phase 4-B(스킬) 진행 중** (`src/resources/js/skill/`). 이 문서가 이 프로토콜의 단일 진실 소스입니다.
> 구현 코드는 이 문서에 정의된 필드/의미론과 항상 일치해야 하며,
> 반대로 구현하다가 이 문서와 다르게 가야 한다는 게 밝혀지면 **코드부터 바꾸지 말고
> 먼저 이 문서를 갱신 + 버전을 올리고 [DECISIONS.md](DECISIONS.md)에 사유를 남긴 뒤** 코드를 바꾸세요.
> "실전 검증 중 틱 길이 같은 걸 바꿀 수 있다"는 건 이미 논의된 전제입니다 — 확정 스펙이 아니라
> 계속 다듬어질 계약서라고 생각하세요.
>
> 용어: 참가자가 짜오는 코드를 **bot**이라고 부릅니다 (이전에 "에이전트"라고 부르던 것과 동일).
> 봇 소스는 **JavaScript** 또는 **Python** 중 하나로 작성됩니다 (§1.3 참고). 프로토콜(§1.1 액션,
> §1.2 스냅샷)은 언어와 무관하며, 언어별 진입점 시그니처만 §1.4에 정의합니다.

## 0. 왜 이 문서가 SOR인가

봇 입출력 형식, enum 값, 틱 길이 같은 상수가 `pikavolley.js`, `physics.js`, 테스트 환경,
제출/중계 도구 등 여러 곳에 흩어져 각자 다르게 정의되면 트랙 간(특히 서로 다른 에이전트 도구를
쓰는 담당자 간) 구현이 어긋납니다. **이 값들은 이 문서에서만 정의하고, 실제 코드는 여기서 import/참조만 하도록 만드세요**
— 구현: [`src/resources/js/bot/botContract.js`](../../src/resources/js/bot/botContract.js) 단일
모듈에 상수/스냅샷 빌더를 박아넣고, 다른 모든 모듈은 거기서 가져다 씁니다 (같은 값을 두 번 정의하지
말 것).

## 1. 봇 입출력 프로토콜

### 1.0 설계 원칙: 엔진의 3필드를 그대로 미러링

기존 게임의 입력 인터페이스는 [`PikaUserInput`](../../src/resources/js/physics.js#L102-L111)
(`xDirection: -1|0|1`, `yDirection: -1|0|1`, `powerHit: 0|1`) **세 필드뿐**입니다. "점프" 버튼은
따로 없고, 땅에 닿은 상태에서 `yDirection === -1`일 때 발생하는 파생 동작입니다
([`physics.js:547-552`](../../src/resources/js/physics.js#L547-L552)). 그리고 파워히트가 발동되는
순간의 `yDirection` 값이 그대로 스매시 각도(못박기/직선/강스매시)를 결정합니다
([`physics.js:718`](../../src/resources/js/physics.js#L718)).

그래서 봇 출력도 4개의 독립 버튼(예: left/right/jump/spike)이 아니라, **엔진과 동일한 3필드**로
정의합니다. 이러면 `left+right` 동시입력 같은 존재하지도 않는 상태를 처리할 필요가 없고, 새 입력
클래스가 `PikaUserInput`과 100% 그대로 호환되어 `keyboardArray` 원소만 교체하면 끼워집니다
([AGENTS.md](../../AGENTS.md) §2 참고).

```
매 tick (getInput()):
  xDirection, yDirection, powerHit = latestAction   // 가장 최근에 도착한 봇 응답을 동기 적용 (D-009)
  if tick % tickFrameGroupSize === 0 and no request pending:
    snapshot = buildGameStateSnapshot(physics, side, meta)   // 엔진 → 봇
    postMessage(worker, { requestId, snapshot })              // 메인 스레드 → 봇 Worker, 비동기 (D-003, §1.3)
    // 응답은 나중에 worker.onmessage로 도착 → latestAction 갱신 (§1.3)
    // 타임아웃 안에 응답이 없으면 latestAction = neutral (D-002)
```

**메인 스레드는 이 틱 안에서 봇의 응답을 기다리지 않습니다** (결정: D-009, 구현 중 발견). 브라우저는
메인(UI) 스레드에서 `Atomics.wait` 같은 블로킹 대기를 허용하지 않고, `postMessage`는 본질적으로
비동기이기 때문에, "요청을 보내고 그 자리에서 동기적으로 응답을 받는" 것 자체가 불가능합니다. 그래서
`getInput()`은 **가장 최근에 도착한 응답**을 적용하고, 이번 틱의 요청은 백그라운드로 흘려보냅니다.
결과적으로 봇의 반응에는 대략 1틱(`tickFrameGroupSize`가 1이면 ~40ms) 정도의 파이프라인 지연이
항상 존재합니다 — 버그가 아니라 구조적 특성입니다. 구현: [`bot/botInput.js`](../../src/resources/js/bot/botInput.js).

### 1.1 봇 출력 (봇 → 엔진)

```json
{ "x": -1, "y": 1, "hit": 1 }
```

| 필드 | 값 | 의미 | 엔진 매핑 |
|---|---|---|---|
| `x` | -1 / 0 / 1 | 왼쪽 / 중립 / 오른쪽 | `PikaUserInput.xDirection` 그대로 |
| `y` | -1 / 0 / 1 | 위 / 중립 / 아래. 땅에서 -1은 점프, 공중 파워히트 순간엔 스매시 각도(못박기/직선/강스매시) | `PikaUserInput.yDirection` 그대로 |
| `hit` | 0 / 1 | 파워히트(공중) 또는 다이빙(지상+`x≠0`) | `PikaUserInput.powerHit` 그대로 |
| `skillX` | 숫자 또는 생략/`null` | **스킬 발동**(D-021 「claw」). 숫자면 그 x를 **중심**으로 발톱을 예약하고, 생략하거나 `null`이면 발동하지 않음 | 엔진 입력이 아님 — 아래 절 참고 |

- **hold 상태 그대로 보내도 안전합니다.** 엔진은 `state`가 바뀌는 순간 조건 자체가 더 이상 성립하지
  않도록 되어 있어서(예: 파워히트 진입 즉시 `state`가 1→2로 바뀜) `hit=1`을 여러 틱 계속 들고 있어도
  중복 발동되지 않습니다. 키보드 입력에만 있는 `powerHitKeyIsDownPrevious` 디바운스
  ([`keyboard.js:71-77`](../../src/resources/js/keyboard.js#L71-L77))는 OS 키 반복 이벤트를 막기 위한
  것이지 엔진 규칙이 아니므로, 봇 프로토콜에서 별도 edge-trigger 규칙을 강제하지 않습니다.
- **시간초과 또는 잘못된 반환값(범위 밖 값, 타입 오류 등)은 무입력(`x=0, y=0, hit=0`)으로
  처리합니다** (결정: D-002). "이전 값 유지"는 하지 않습니다 — 기존 `PikaKeyboard`/기본 AI 둘 다
  매 틱 0으로 리셋한 뒤 그 틱에 확정된 것만 채우는 방식이라([`physics.js:804-806`](../../src/resources/js/physics.js#L804-L806)),
  무입력이 기존 관례와 일치하고 타임아웃이 반복돼도(행) "멈춰있음"으로 명확히 보여 오작동처럼 보이지
  않습니다.

#### `skillX` (스킬 발동, 결정: D-022)

기존 3필드는 전부 엔진의 `PikaUserInput`에 1:1로 들어가지만, `skillX`는 **엔진 밖 스킬 계층**이
읽는 값이라 성격이 다릅니다.

- **좌표**: 코트 전체 `0 ~ GROUND_WIDTH(432)`. 범위를 벗어난 값은 **코트 안으로 클램프**되며,
  발동 자체가 거절되지는 않습니다. 자기 진영을 노리는 것도 막지 않습니다(손해일 뿐 반칙이 아님).
- **하위 호환**: 이 필드가 없는 기존 봇은 그대로 동작합니다. `undefined`/`null` = 미발동이며,
  숫자가 아닌 값(문자열, `NaN`, `Infinity` 등)은 §1.1의 원칙대로 **그 틱의 발동만 무시**합니다
  (액션 전체를 무입력으로 만들지는 않습니다 — x/y/hit이 멀쩡하면 이동은 계속됩니다).
- **소비 시점**: 봇 응답 1건당 **최대 1회 발동**입니다. 한 틱은 `TICK_FRAME_GROUP_SIZE` 프레임
  동안 유지되므로(§2), 같은 응답이 여러 프레임에 걸쳐 재발동해 게이지를 반복 소모하지 않도록
  스킬 계층이 값을 한 번 읽고 비웁니다.
- **발동 실패는 조용히 무시**됩니다: 게이지 부족, 이미 예고 중, 시전자가 기절 중, 랠리 밖.
  실패해도 게이지는 줄지 않습니다.
- **키보드 플레이어**는 이 필드와 무관하게 발동 키(기본 `KeyC` / `ShiftRight`)를 쓰며, 이 경우
  범위는 **발동 시점 상대 위치를 중심**으로 자동 결정됩니다 (사람이 좌표를 입력할 방법이 없으므로).

- **발동에 필요한 정보**(자기/상대 게이지, 예고 중인 발톱 범위, 소모량·범위 폭 같은 튜닝 상수)는
  §1.2 스냅샷에 들어 있습니다 (v0.7, D-023).

### 1.2 게임 상태 스냅샷 (엔진 → 봇)

**좌표계** — 원본 엔진의 정수 픽셀 좌표를 **변환 없이 그대로** 노출합니다 (결정: D-007).
원점은 좌상단, x는 오른쪽으로, **y는 아래쪽으로** 증가합니다 (일반적인 "바닥=0" 직관과 반대이니
주의). 참고 상수:

| 상수 | 값 | 의미 |
|---|---|---|
| `GROUND_WIDTH` | 432 | 코트 전체 폭 (x: 0~432) |
| `GROUND_HALF_WIDTH` | 216 | 네트 x좌표 |
| `PLAYER_TOUCHING_GROUND_Y_COORD` | 244 | 플레이어 접지 y |
| `BALL_TOUCHING_GROUND_Y_COORD` | 252 | 공 접지 y |
| `BALL_RADIUS` | 20 | |
| `PLAYER_LENGTH` (half) | 64 (32) | |
| `NET_PILLAR_HALF_WIDTH` | 25 | 네트 기둥 반폭 (x: 216±25) |
| `NET_PILLAR_TOP_TOP_Y_COORD` / `..._BOTTOM_Y_COORD` | 176 / 192 | 네트 기둥 상단 y 범위 |

```json
{
  "matchId": "string",
  "tick": 12345,
  "side": "LEFT",
  "self":  { "x": 120, "y": 244, "state": 0, "frameNumber": 3, "divingDirection": 0,
             "lyingDownDurationLeft": -1, "gauge": 70, "claw": null },
  "opp":   { "x": 300, "y": 180, "state": 1, "frameNumber": 5, "divingDirection": 0,
             "lyingDownDurationLeft": -1, "gauge": 30,
             "claw": { "centerX": 120, "framesUntilStrike": 12, "framesLeftActive": 0 } },
  "ball":  { "x": 216, "y": 140, "xVelocity": -3, "yVelocity": 6, "expectedLandingPointX": 340, "isPowerHit": false },
  "meta":  { "score": { "self": 7, "opp": 6 }, "isPlayer2Serve": false, "rallyFrameCount": 42 },
  "config": {
    "tickFrameGroupSize": 3,
    "gauge": { "min": 0, "max": 100, "onReceive": 10, "onExtraTouch": -5, "onServe": 0 },
    "claw":  { "cost": 50, "width": 96, "warningFrames": 25, "stunFrames": 25, "activeFrames": 10 }
  }
}
```

필드 출처 (엔진 값 + 엔진 밖 스킬 계층 값. 봇 편의를 위해 새로 계산해 지어낸 값은 없습니다):

- **self / opp** ([`Player`](../../src/resources/js/physics.js#L124) 기준): `x`, `y`,
  `state`(0정상/1점프/2파워히트/3다이빙/4누움-기절/5승리/6패배), `frameNumber`, `divingDirection`,
  `lyingDownDurationLeft`, 그리고 스킬 계층이 채우는 `gauge`/`claw`(아래 §1.2.1).
  둘 다 **완전 대칭 정보**를 줍니다 (상대 정보를 숨기지 않음 — 실제로도 사람이 화면을 보면 다
  보이는 정보이므로 인위적으로 가릴 이유가 없다고 판단).
  - `lyingDownDurationLeft`: `state === 4`(누움/기절)일 때 남은 시간. 엔진이 매 프레임 1씩 줄이고
    `-1` 미만이 되면 `state = 0`으로 돌아가므로, **움직일 수 있게 되기까지 `값 + 2` 프레임**입니다
    ([`physics.js:507-512`](../../src/resources/js/physics.js#L507-L512)). 그 외 상태에서는 엔진이
    남겨둔 값이 그대로 보이므로 `state === 4`일 때만 의미가 있습니다.
  - `x`/`y` 속도: 자신의 속도는 직전에 자신이 낸 입력으로 알 수 있고(수평 이동은 관성이 없어
    입력에 따라 그 프레임에 즉시 결정됨), 상대 속도가 필요하면 봇이 직전 틱 스냅샷과 비교해
    직접 계산하면 됩니다 (단발성 차분이라 엔진 도움이 굳이 필요 없음 — 아래 `ball.expectedLandingPointX`
    와는 성격이 다름, D-006 참고).
- **ball** ([`Ball`](../../src/resources/js/physics.js#L226) 기준): `x`, `y`, `xVelocity`, `yVelocity`,
  `isPowerHit`, 그리고 **`expectedLandingPointX`**.
  - `expectedLandingPointX`는 엔진이 매 프레임 두 플레이어 모두에 대해 이미 계산해두는 값이고
    ([`physics.js:323`](../../src/resources/js/physics.js#L323)), 기본 탑재 AI의 포지셔닝/점프 타이밍
    판단이 전부 이 값 하나에서 나옵니다 ([`physics.js:808-857`](../../src/resources/js/physics.js#L808-L857)).
    **그대로 노출하기로 결정** (D-006): 이건 "AI의 비밀"이 아니라 반응이 성립하기 위한 기반값이고,
    숨기면 모든 참가자가 (네트 충돌 포함) 동일한 탄도 시뮬레이션 루프를 각자 재구현하느라 현장 시간을
    깎아먹을 뿐 전략적 변별력에 기여하지 않는다고 판단했습니다.
- **meta**: `score`, `isPlayer2Serve`, 랠리 경과 프레임 수. **세트(`set`/`max_set`) 개념은 넣지
  않습니다** (D-008) — 엔진은 원래 단판(`winningScore=15`)까지만 지원하고, 다판제가 필요하면
  엔진 밖에서(운영 스크립트 레벨로) 그냥 여러 판을 돌리면 되므로 프로토콜에 부담을 얹지 않습니다.
- **config**: `tickFrameGroupSize` — §2 참고. 별도의 ms 단위 필드(`decision_interval_ms` 등)는
  두지 않습니다. 엔진의 시계는 연속적인 ms가 아니라 이산적인 프레임이므로, "몇 프레임을 한 틱으로
  묶는지"(`tickFrameGroupSize`, D-001)라는 하나의 정수 개념으로 통일합니다. 실제 ms가 필요하면
  봇이 `tick * 40 * tickFrameGroupSize`로 직접 계산하면 됩니다. `gauge`/`claw` 블록은 §1.2.1 참고.

### 1.2.1 스킬 관련 필드 (결정: D-023)

스킬 계층([`src/resources/js/skill/`](../../src/resources/js/skill/))이 채우는 값입니다. 엔진
필드가 아니지만 봇이 스킬을 쓰거나 피하려면 반드시 필요합니다 (이게 없으면 봇은 발동만 가능하고
**회피가 구조적으로 불가능**합니다 — D-023 배경).

| 필드 | 값 | 의미 |
|---|---|---|
| `self.gauge` / `opp.gauge` | `0 ~ 100` | 현재 게이지 (충전 규칙은 D-020). 상대 것도 그대로 보여줍니다 — 화면 게이지 바에 이미 양쪽 다 그려져 있습니다 |
| `self.claw` / `opp.claw` | 객체 또는 `null` | **그 플레이어가 시전한** 발톱. 발동 중이 아니면 `null`(Python은 `None`) |
| `.claw.centerX` | 0 ~ 432 | 발톱 범위의 중심 x |
| `.claw.framesUntilStrike` | 정수 | 발톱이 터지기까지 남은 프레임. `0`이면 이미 터졌고 연출만 남은 상태 |
| `.claw.framesLeftActive` | 정수 | 연출이 사라지기까지 남은 프레임. 이게 끝나야 그 플레이어가 재발동할 수 있습니다 |
| `config.gauge` | `{min, max, onReceive, onExtraTouch, onServe}` | 게이지 범위와 증감폭 (D-020) |
| `config.claw` | `{cost, width, warningFrames, stunFrames, activeFrames}` | 「claw」 튜닝 상수 (D-021 §3) |

- **`claw`는 시전자 기준**입니다. 발톱의 피해자는 항상 시전자의 상대이므로 **`opp.claw`가 나를
  노리는 발톱**이고, `self.claw`는 내가 쏜 것(= `null`이 아니면 재발동이 거절됨)입니다.
- **맞는 조건**은 x축만 봅니다: `|self.x - opp.claw.centerX| <= config.claw.width / 2 + 32`
  (32 = `PLAYER_HALF_LENGTH`). 점프로는 못 피하고 좌우 이동만이 회피 수단입니다(D-021 §4-2).
  이 판정을 미리 계산한 불리언은 주지 않습니다 — 회피 판단 자체가 이 스킬의 전략입니다.
- **`config.claw.stunFrames`는 실제 기절 지속 프레임 수(25)** 입니다. 소스 상수
  `CLAW_STUN_FRAMES`(23)는 엔진이 N+2 프레임을 쓰는 내부 사정에서 나온 값이라 그대로 노출하지
  않습니다.
- **튜닝 상수를 매 틱 실어 보내는 이유**: 이 숫자들은 전부 아직 stub이고 실측 후 조정 1순위라,
  봇이 하드코딩하면 값이 바뀌는 순간 에러도 없이 조용히 틀린 판단을 하게 됩니다 (D-023 §3).
- **값의 시점**: 스킬 트래커는 `gameLoop()` 뒤에 관찰하고 스냅샷은 `getInput()`(= `gameLoop()` 안)
  에서 만들어지므로, 이 값들은 **직전 프레임 종료 시점**의 상태입니다. 나머지 스냅샷 필드와 시점이
  같으므로 스냅샷 내부에서 어긋나지는 않습니다. 다만 §1.0의 파이프라인 지연(약 1틱)이 더해지므로
  `framesUntilStrike`의 **마지막 몇 프레임은 믿지 마세요** — 실제 회피 여유는 그보다 최대
  6프레임 정도 짧습니다.
- **배선이 없으면 stub**: 스킬 계층이 주입되지 않은 경로에서는 `gauge`/`claw`/`config.gauge`/
  `config.claw`가 전부 `null`로 나갑니다. 실제 게임에서는 `main.js`가 항상 주입합니다.

### 1.3 실행 모델: Web Worker 격리 (결정: D-003, D-012)

봇 코드는 메인 스레드에서 `eval`/동적 `import`로 직접 돌리지 않고, **별도의 Web Worker**에서
실행합니다. 이유: 메인 스레드에서 직접 돌리면 봇 코드의 무한루프/과도한 연산이 렌더링과 상대방
입력까지 포함한 게임 전체를 멈춰버리고, 동기 코드는 밖에서 강제로 끊을 방법이 없습니다.

- **언어별 러너**: `PikaBotInput`은 각 side의 `language` (`'js'` | `'py'`)에 따라 서로 다른 Worker
  스크립트를 spawn합니다. JavaScript 봇은 [`bot/botWorker.js`](../../src/resources/js/bot/botWorker.js)
  (봇 소스를 `new Function()`으로 컴파일해 `decide` 심볼 확보), Python 봇은
  [`bot/botWorkerPython.js`](../../src/resources/js/bot/botWorkerPython.js)(Pyodide로 CPython 인터프리터를
  Worker 안에 부팅한 뒤 참가자 소스를 실행). 두 러너 모두 동일한 `{type:'init'|'tick'} ↔
  {type:'initResult'|'result'}` 프로토콜을 지키므로 `PikaBotInput`/게임 루프 쪽은 언어를 알 필요가
  없습니다 (D-012 이유). Worker 자체는 두 러너 모두 `{ type: 'module' }` ES module Worker로 통일 —
  Pyodide는 `pyodide.mjs`를 dynamic import하는 방식으로 로드합니다. 언어별 진입점 시그니처는
  §1.4 참고.
- 매 틱: 메인 스레드가 스냅샷을 `postMessage`로 Worker에 보냄 → Worker 안에서 봇 함수 실행 →
  결과를 다시 `postMessage`로 반환.
- 응답이 타임아웃 안에 안 오면 그 틱은 무입력 처리(§1.1, D-002). 반복적으로 응답이 없으면(행)
  `worker.terminate()`로 강제 종료 후 재시작 — 다른 쪽 경기 진행에는 영향 없음.
- 이번 대회는 참가자 신원이 확인되고 운영진이 사전 검수하는 친선전이라, 위협 모델상 "악성 코드 차단"
  (강한 보안 샌드박싱, 예: `allow-same-origin` 없는 iframe)보다 "현장에서 버그 하나가 시연 PC를
  멈추는 것 방지"가 실질 리스크라고 판단해 Worker 격리 수준으로 확정했습니다. 더 강한 보안 격리가
  필요하다고 판단되면 이 섹션을 갱신하세요.
- Worker 간 메시지 패싱에는 약간의 오버헤드가 있습니다 — §2의 틱 예산과 함께 Phase 2(테스트 환경)
  구현 시 실측하세요.
- 위 통신은 전부 **비동기**입니다 (`postMessage`에는 동기 응답 대기 수단이 없음) — §1.0의 D-009 참고.
  구현에서는 매 요청에 `requestId`를 붙여, 타임아웃으로 이미 폐기된 요청의 뒤늦은 응답이나 재시작
  전 Worker의 응답이 최신 상태를 덮어쓰지 않도록 막습니다.
- 구현: [`bot/botContract.js`](../../src/resources/js/bot/botContract.js)(상수/스냅샷 빌더),
  [`bot/botWorker.js`](../../src/resources/js/bot/botWorker.js)(JS 러너),
  [`bot/botWorkerPython.js`](../../src/resources/js/bot/botWorkerPython.js)(Python 러너, Pyodide 기반),
  [`bot/botInput.js`](../../src/resources/js/bot/botInput.js)(`PikaBotInput`, `PikaUserInput` 상속,
  language 파라미터에 따라 러너 선택).

### 1.4 언어별 진입점 시그니처 (결정: D-013, D-017, D-018)

프로토콜(§1.1 액션, §1.2 스냅샷)은 언어와 무관하지만, 참가자가 어떤 형태로 함수를 정의하는지는
언어마다 다릅니다.

#### 1.4.1 JavaScript

```js
function decide(snapshot) {
  return { x: -1|0|1, y: -1|0|1, hit: 0|1 };
}
```

- 봇 소스는 텍스트로 전달됨. Worker에서 `new Function(source + "\n;return decide;")`로 컴파일하고
  최상위에 `decide`라는 이름의 함수가 있어야 함
  ([`bot/botWorker.js:31-35`](../../src/resources/js/bot/botWorker.js#L31-L35)).
- 사용 가능 API: `console.log`, `Math`, `Date` 등 표준 JS 전역. `import`/`fetch`/DOM 접근 등은 Worker
  환경상 불가.
- 초기화 실패(문법 오류, `decide` 미정의)는 `onInitResult`로 UI에 에러 표시. 매 틱 예외/잘못된 반환은
  무입력(D-002).

#### 1.4.2 Python

```python
def decide(snapshot: dict) -> dict:
    return {'x': -1, 'y': 0, 'hit': 0}
```

- 봇 소스는 텍스트로 전달됨. Pyodide Worker가 `pyodide.runPython(source)`로 실행하고, 그 결과
  전역 스코프의 `decide` 심볼을 잡아둠. **최상위에 `decide`라는 이름으로 정의된 함수여야 함** (JS와
  동일 규칙, D-013).
- `snapshot`은 §1.2의 JS 스냅샷을 Pyodide `pyodide.ffi.to_py()`로 변환한 Python `dict`. 접근:
  `snapshot['self']['x']`, `snapshot['ball']['expectedLandingPointX']`, `snapshot['meta']['score']['self']` 등.
  모든 필드는 §1.2 표 그대로.
- 반환은 Python `dict` (`{'x': ..., 'y': ..., 'hit': ...}`). Pyodide가 JS 객체로 되돌린 뒤
  `isValidBotAction()`([`bot/botContract.js:60-67`](../../src/resources/js/bot/botContract.js#L60-L67))로
  검증되며, 유효 범위 밖이거나 반환값이 dict가 아니면 그 틱은 무입력(D-002 동일).
- **사용 가능 라이브러리** (D-018): Python 표준 라이브러리 전체 + **numpy**. `import math`, `import
  random`, `import numpy as np` 등 즉시 가능. `scipy`/`scikit-learn`/`pandas` 등은 기본 미포함 →
  `import` 시 `ModuleNotFoundError`로 초기화 실패 (필요 시 참가자 요청으로 별도 ADR로 추가).
- **초기화 지연** (D-015): Pyodide는 지연 로드입니다 — Bot Setup에서 Python side가 선택되고 Apply를
  누른 다음 라운드가 시작될 때 처음으로 Worker가 spawn되면서 Pyodide + numpy 로드가 시작됨. 이
  사이에는 §1.1의 무입력이 계속 나오고, UI 상태 줄에 `"Python 로딩 중..."` → `"Python 준비 중...
  (numpy 로딩)"` → `"봇 코드 로드됨"` 순서로 진행 표시.
- **실패 처리** (D-017, D-002 확장): 초기화 단계(Pyodide 로드 실패, `SyntaxError`, `decide` 미정의,
  허용 목록 밖 `import`)는 `onInitResult`로 UI에 에러 문자열 노출. 매 틱 단계(예외/타임아웃/잘못된
  반환)는 그 틱만 무입력(D-002 그대로).
- **디버깅**: `print(...)`는 Pyodide가 브라우저 콘솔로 리다이렉트하므로, 봇 Worker의 콘솔에서 확인
  가능(JS의 `console.log`와 동일한 위치).

## 2. 타이밍 / 틱 상수

원작 기준 실측값 (모두 [`pikavolley.js`](../../src/resources/js/pikavolley.js), [`main.js`](../../src/resources/js/main.js) 근거):

| 항목 | 값 | 근거 |
|---|---|---|
| 평상시 FPS | 25 | `pikavolley.js:54` `normalFPS = 25` |
| 평상시 1 프레임 길이 | **40ms** | `1000/25` |
| 슬로모션 FPS | 5 | `pikavolley.js:56` `slowMotionFPS = 5` |
| 슬로모션 지속 프레임 수 | 6 | `pikavolley.js:59` `SLOW_MOTION_FRAMES_NUM = 6` (골 직후에만 발동) |
| 틱 구동 방식 | PixiJS `Ticker`, `ticker.maxFPS = normalFPS` | `main.js:154-161` |

**봇 연산 예산 (결정: D-016, D-001을 SUPERSEDE)**: `tickFrameGroupSize = 3` (3 프레임 = 1 틱 =
120ms)로 상향. 원래 D-001에서 1로 확정했으나 두 가지 근거로 재논의됨:
(i) 다국어 봇 지원(D-012)으로 Pyodide 호출 오버헤드가 매 틱 더해짐,
(ii) 매 프레임 결정 시 양쪽 봇 모두 즉각 반응해서 승부가 잘 갈리지 않는 밸런스 문제(팀장 관찰).
120ms 예산이면 Pyodide + 간단한 numpy 연산에 여유가 있고, 3프레임 단위 결정이면 봇 반응 사이에
사람이 감지 가능한 지연이 생겨 전략 변별력이 살아납니다. 자세한 근거·트레이드오프는
[ADR-0016](decisions/ADR-0016-tick-frame-group-size-raised.md) 참고. 값은 여전히 상수
([`bot/botContract.js`](../../src/resources/js/bot/botContract.js)의 `TICK_FRAME_GROUP_SIZE`)로 빼둬서
실측 후 5/7 등으로 재조정하기 쉽게 유지합니다.

`gameLoop()`은 `deltaTime` 보정 없이 "호출 1번 = 프레임 1개 전진"하는 구조라([`main.js:156-158`](../../src/resources/js/main.js#L156-L158))
연산이 40ms를 넘겨도 게임이 깨지거나 desync되지 않고 체감 fps만 잠깐 떨어집니다 — 진짜 위험
(무한루프로 메인 스레드가 멈추는 것)은 §1.3(D-003, Worker 격리)와 D-002(무입력 폴백)로 따로
대응합니다.

파생 상수 `BOT_RESPONSE_TIMEOUT_MS` = `MS_PER_FRAME * TICK_FRAME_GROUP_SIZE * 3`이라 자동으로
40ms×3×3 = **360ms**까지 늘어남 — Pyodide 첫 콜의 워밍업까지 흡수 가능. 시간초과/잘못된 반환값
처리는 §1.1에서 무입력으로 확정했습니다 (D-002).

## 3. 변경 이력

| 버전 | 날짜 | 변경자 | 내용 |
|---|---|---|---|
| v0.1 | 2026-07-07 | (agent-settings 초기 세팅) | 최초 작성. 프로토콜/타이밍 모두 DRAFT, 구현 전 |
| v0.2 | 2026-07-07 | (agent-settings 초기 세팅) | 용어를 "에이전트"→"bot"으로 통일. 출력을 4-bit(`left/right/jump/spike`)에서 엔진과 1:1 대응하는 3필드(`x/y/hit`)로 변경. 좌표계를 원본 정수 픽셀 그대로 쓰기로 확정(D-007). `expectedLandingPointX` 노출 확정(D-006). 세트제 미도입 확정, `meta.set/max_set` 제거(D-008). `decision_interval_ms`/`max_response_ms`를 `config.tickFrameGroupSize` 하나로 통합 |
| v0.3 | 2026-07-07 | Claude Code (사용자 승인) | `tickFrameGroupSize = 1` 확정(D-001). 시간초과/잘못된 반환값 처리를 무입력으로 확정(D-002). 실행 모델을 Web Worker 격리(+타임아웃+강제종료 후 재시작)로 확정(D-003), §1.3 신설 |
| v0.4 | 2026-07-11 | Claude Code (구현 중 발견 — 사용자 확인 요망) | Phase 1 실제 구현(`src/resources/js/bot/`) 진행 중 발견: 메인 스레드가 Worker 응답을 그 틱 안에 동기 대기할 수 없음(브라우저가 `Atomics.wait`를 메인 스레드에서 막음) → fire-and-forget + "최근 응답 사용" 패턴으로 확정, 약 1틱 파이프라인 지연을 구조적 특성으로 문서화(D-009). §1.0/§1.3에 반영, 구현 파일 링크 추가 |
| v0.5 | 2026-08-05 | Claude Code (팀장 결재) | 다국어 봇 지원(Python 우선) 확정 — 브라우저 내 WASM 방식(Pyodide, D-012)으로 §1.3에 언어별 러너 개념 추가, §1.4 신설(Python `decide` 시그니처 D-013, Pyodide 지연 로드 D-015, 실패 처리 D-017, 라이브러리 범위 D-018). `TICK_FRAME_GROUP_SIZE`를 1→3으로 상향(D-016, D-001 SUPERSEDE) — Pyodide 오버헤드 흡수 + 밸런스 개선. Pyodide 배포는 정적 복사(D-014) |
| v0.7 | 2026-08-11 | Claude Code (팀장 결재) | **스냅샷(§1.2) 스킬 확장** — 플레이어 뷰에 `gauge`·`claw`(시전자 기준, 발동 중이 아니면 `null`)·`lyingDownDurationLeft` 추가, `config`에 `gauge`/`claw` 튜닝 상수 블록 추가, §1.2.1 신설. 이걸로 봇이 처음으로 **발톱 회피와 게이지 관리**를 할 수 있게 됨(D-023). 기존 필드는 제거·개명 없음 → 3필드 봇 무변경 동작 |
| v0.6 | 2026-08-11 | Claude Code (팀장 결재) | 스킬 발동을 봇 액션에 추가 — 4번째 필드 `skillX`(숫자면 그 x를 중심으로 「claw」 발동, 생략/`null`이면 미발동, 좌표는 코트 전체 0~432에서 클램프, 응답 1건당 최대 1회 소비). 기존 3필드 봇은 무변경으로 계속 동작(D-022). §1.1에 필드와 세부 규칙 추가. **스냅샷(§1.2) 확장(게이지·예고 중인 발톱 노출)은 이번 버전에 포함되지 않음** — 별도 작업 |
