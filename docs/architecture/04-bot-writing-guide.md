# 04. 봇 코드 작성 가이드 (Try-out용)

> **이 문서는 "현재 코드 기준" 스냅샷입니다.** 작성 시점: 2026-07-28,
> [`docs/agent-dev/CONTRACTS.md`](../agent-dev/CONTRACTS.md) v0.4 + `src/resources/js/bot/` 구현 기준.
> 프로토콜(필드/타이밍)의 단일 진실 소스(SOR)는 항상 CONTRACTS.md이고, 거기 값이 바뀌면 이 문서도
> 같이 갱신해야 한다 — 이 문서는 그걸 실제로 "손으로 봇 코드를 짜서 붙여넣고 돌려보는" 사람 입장에서
> 풀어 쓴 실전 가이드다. 배경 구조(왜 이렇게 만들었는지)는 [03-bot-integration.md](./03-bot-integration.md) 참고.

## 1. 한 줄 요약

봇 코드는 **`decide(snapshot)`이라는 함수 하나만 정의하면 되는 평범한 JS 텍스트**다. 매 틱
게임 상태(`snapshot`)를 인자로 받아 `{ x, y, hit }` 세 값을 반환하면, 그게 그대로 그 진영의 키
입력(좌우/점프/파워히트)으로 쓰인다.

## 2. 시작하기: Bot Setup 패널 사용법

1. 게임 화면 상단 메뉴바에서 **"Bot Setup"** 버튼을 누른다 (에셋 로딩이 끝나야 활성화됨).
2. "Bot Test Setup" 패널이 뜨면 왼쪽(Player 1)/오른쪽(Player 2)을 각각 독립적으로 고른다:
   - **Keyboard** — 원래대로 사람이 물리 키로 조작.
   - **Bot code** — 아래 텍스트박스에 코드를 붙여넣는다. 직접 짜도 되고, **"Load example bot"**
     버튼을 누르면 기본 예시(추격형 봇, 5절 참고)가 채워진다.
   - **Built-in AI** — 원작 기본 탑재 AI가 조작.
3. **"Apply (restart)"** 를 누른다. 이 순간 즉시 바뀌는 게 아니라 게임이 인트로 화면으로 리셋되고,
   메뉴에서 1P/2P를 다시 고른 뒤 실제 랠리(`round` 상태)가 시작되는 순간부터 설정이 적용된다
   (왜 그런지는 [03-bot-integration.md §4](./03-bot-integration.md#4-그-외-게임-진행-관련-수정) 참고).
4. 코드에 문법 오류가 있거나 `decide` 함수가 없으면, 텍스트박스 아래 상태 줄에 로드 결과("봇 코드
   로드됨" / "에러: ...")가 표시된다.
5. 랠리 진행 중 코드를 고쳐서 다시 테스트하려면, 텍스트박스 내용을 바꾸고 다시 **Apply**를 누르면
   된다 (역시 인트로로 리셋 후 다음 랠리부터 반영).
6. 경기가 끝나 인트로로 돌아오면 그 진영은 잠깐 실제 키보드로 바뀐다 — 다음 경기 메뉴 선택(파워히트
   키)까지는 사람이 진행해야 한다. 메뉴를 통과해 다음 경기가 시작되면 저장된 설정이 자동으로 다시
   적용된다.

## 3. `decide` 함수의 요건

```js
function decide(snapshot) {
  // ... 판단 로직 ...
  return { x: 0, y: 0, hit: 0 };
}
```

- **반드시 최상위(top-level)에 `decide`라는 이름으로 정의된 함수여야 한다.** `function decide(s) {...}`
  형태가 가장 확실하다. 코드 실행 후 `typeof decide === 'function'`을 검사해서 못 찾으면 그대로
  초기화 실패로 처리된다 ([`bot/botWorker.js:31-35`](../../src/resources/js/bot/botWorker.js#L31-L35)).
- **한 틱에 한 번, 동기적으로 호출된다.** 반환값은 그 호출이 끝나는 즉시 쓰이는 값이어야 한다 —
  `fetch`/`setTimeout` 콜백 안에서 나중에 `return`하거나 `Promise`를 반환해도 소용없다. Promise
  객체는 `{x,y,hit}` 형태가 아니므로 그냥 무입력으로 처리된다.
- **`decide` 바깥에 선언한 변수/함수는 틱 사이에 그대로 유지된다.** 이 소스 전체가 최초 로드 시
  딱 한 번 평가되고 `decide` 함수만 계속 재사용되는 구조라서, 최상위 `var` 등으로 카운터나 이전
  틱 정보를 저장해두는 게 자연스럽다. 예시(5절 추격형 봇의 `tickCounter`) 참고.
- **`import`/`export`, 외부 라이브러리, DOM/`window` 접근, 네트워크 요청은 쓸 수 없다.** 코드는
  격리된 Web Worker 안에서 일반 스크립트로 파싱된다 (`new Function(...)`) — `let`/`const`/화살표
  함수/클래스 같은 최신 문법은 문제없이 되지만, 모듈 문법(`import` 등)은 구문 오류로 초기화가
  실패한다. `console.log`는 쓸 수 있고, 브라우저 개발자 도구의 Worker 콘솔(예: Chrome
  DevTools → Sources → 좌측 트리의 별도 Worker 항목)에서 출력을 볼 수 있다.
- **`decide` 안에서 던진 예외는 그 틱만 무입력으로 처리되고 조용히 넘어간다.** 패널에는 초기화
  단계(문법 오류/함수 없음)의 에러만 표시되고, 매 틱 실행 중 예외는 UI에 따로 뜨지 않는다
  ([`bot/botInput.js:115-121`](../../src/resources/js/bot/botInput.js#L115-L121)). 디버깅할 땐 `decide`
  안에 직접 `try/catch` + `console.log`를 넣어 무슨 값이 오갔는지 확인하는 걸 추천.
- **반환값의 각 필드가 유효 범위를 벗어나도(타입 오류 포함) 그 틱은 무입력으로 처리된다** — 4절 참고.

### 3.1 로그로 디버깅하기

`decide`는 매 틱(기본 설정 기준 초당 25번, 40ms마다) 호출된다. 매번 `console.log`를 찍으면 콘솔이
순식간에 도배되어 오히려 아무것도 못 읽는다 — **틱 카운터를 두고 N틱에 한 번만 찍는 게 사실상
필수**다.

```js
var tickCounter = 0; // decide 밖, 최상위에 선언 (틱 사이에 유지됨, 위 3절 참고)
var LOG_EVERY_N_TICKS = 25; // 대략 1초에 한 번 (25fps 기준)

function decide(s) {
  tickCounter++;
  // ... 판단 로직 ...
  var result = { x: 0, y: 0, hit: 0 };

  if (tickCounter % LOG_EVERY_N_TICKS === 0) {
    console.log(
      'tick=' + s.tick +
      ' state=' + s.self.state +
      ' self=(' + s.self.x + ',' + s.self.y + ')' +
      ' ball=(' + s.ball.x + ',' + s.ball.y + ')' +
      ' ->', result
    );
  }
  return result;
}
```

- 6.1의 추격형 예시 코드가 정확히 이 패턴(`tickCounter % 100`)을 이미 쓰고 있다 — 그대로 복사해서
  로그 내용만 원하는 필드로 바꿔 써도 된다.
- 매번 주기적으로 찍는 대신, 특정 순간만 보고 싶으면(예: 파워히트를 시도한 틱만) 조건부로 찍는
  것도 방법이다: `if (result.hit === 1) console.log(...)`.
- 로그는 메인 페이지 콘솔이 아니라 **이 봇 전용 Worker의 콘솔**에 찍힌다. 최신 Chrome은 보통 메인
  콘솔에도 같이 표시해주지만, 안 보이면 개발자 도구 Sources 패널 좌측 상단의 컨텍스트
  선택기(또는 `chrome://inspect` → Workers 목록)에서 이 봇의 Worker를 선택해서 확인한다.
- `decide` 안에서 예외가 나면(위 3절) 상태 패널엔 안 뜨므로, 의심되는 구간을 `try/catch`로 감싸고
  catch 블록에서 `console.log(error)`를 찍어보는 것도 유용하다.

## 4. 입력(스냅샷)과 반환값(키 입력) 형식

### 4.1 매 틱 받는 것: `snapshot`

```json
{
  "tick": 12345,
  "side": "LEFT",
  "self":  { "x": 120, "y": 244, "state": 0, "frameNumber": 3, "divingDirection": 0 },
  "opp":   { "x": 300, "y": 180, "state": 1, "frameNumber": 5, "divingDirection": 0 },
  "ball":  { "x": 216, "y": 140, "xVelocity": -3, "yVelocity": 6, "expectedLandingPointX": 340, "isPowerHit": false },
  "meta":  { "score": { "self": 7, "opp": 6 }, "isPlayer2Serve": false, "rallyFrameCount": 42 },
  "config": { "tickFrameGroupSize": 1 }
}
```

| 필드 | 의미 |
|---|---|
| `tick` | 이 봇 인스턴스 기준 누적 틱 카운터 |
| `side` | `'LEFT'` 또는 `'RIGHT'` — 내가 어느 진영인지 |
| `self` / `opp` | 나 / 상대의 `x`, `y`, `state`, `frameNumber`, `divingDirection`. **완전 대칭 정보**라 상대 것도 다 보임 |
| `self.state` / `opp.state` | 아래 4.2절 표 참고 |
| `ball.x/y` | 공 좌표 |
| `ball.xVelocity/yVelocity` | 공 속도 |
| `ball.expectedLandingPointX` | 엔진이 이미 계산해둔, 공의 예상 낙하 x좌표 (기본 AI도 이걸로 판단) |
| `ball.isPowerHit` | 직전에 파워히트로 맞은 공인지 |
| `meta.score` | `{ self, opp }` — 항상 내 기준으로 정렬됨 |
| `meta.isPlayer2Serve` | 현재 서브권이 Player2(오른쪽)인지 |
| `meta.rallyFrameCount` | 이번 랠리 시작 후 지난 틱 수 |
| `config.tickFrameGroupSize` | 몇 프레임마다 한 번 `decide`가 불리는지 (현재 1 = 매 프레임) |

**좌표계**: 원본 엔진의 정수 픽셀 그대로, 변환 없음. 원점은 좌상단, x는 오른쪽으로 증가,
**y는 아래쪽으로 증가**(값이 작을수록 위쪽)한다. 코트 폭 432(`x: 0~432`), 네트 x좌표 216, 공
반지름 20 등 세부 상수는 [`bot/botContract.js:12-21`](../../src/resources/js/bot/botContract.js#L12-L21) 참고.

### 4.2 `self.state` / `opp.state` 값

| 값 | 의미 | 참고 |
|---|---|---|
| 0 | 정상(땅에 서 있음) | 이 상태에서만 점프/다이빙 시작 가능 |
| 1 | 점프 중 | 이 상태에서 `hit=1`이면 파워히트 발동 |
| 2 | 파워히트 동작 중 | 스매시 애니메이션 진행 중, 새 입력으로 못 바꿈 |
| 3 | 다이빙 중 | |
| 4 | 다이빙 후 누워있음 | |
| 5 | 승리 모션 | 경기 종료 시 |
| 6 | 패배 모션 | 경기 종료 시 |

### 4.3 매 틱 돌려줘야 하는 것: 반환값

```json
{ "x": -1, "y": 1, "hit": 1 }
```

| 필드 | 유효값 | 의미 |
|---|---|---|
| `x` | `-1` / `0` / `1` | 왼쪽 / 중립 / 오른쪽 이동 |
| `y` | `-1` / `0` / `1` | 위(점프 트리거) / 중립 / 아래. **파워히트 발동 순간의 `y` 값이 스매시 각도를 결정** (아래 표) |
| `hit` | `0` / `1` | 파워히트 또는 다이빙 트리거 (아래 표) |

세 값 중 하나라도 이 범위를 벗어나거나(타입 오류 포함), 틱 안에 응답이 안 오면(타임아웃) 그 틱은
**무입력**(`x=0, y=0, hit=0`)으로 처리된다 — "직전 값 유지" 같은 건 하지 않는다.

## 5. `{x, y, hit}`이 실제로 만드는 동작

엔진(`physics.js`)이 이 세 값을 해석하는 실제 조건 — 원본 게임 조작과 동일하다:

| 상황 (내 `state`) | 입력 조건 | 결과 |
|---|---|---|
| 0 (땅) | `y = -1` | 점프 시작 → `state = 1` ([physics.js:547-553](../../src/resources/js/physics.js#L547-L553)) |
| 0 (땅) | `hit = 1` 그리고 `x ≠ 0` | 다이빙 시작 → `state = 3`, 다이빙 방향 = 이때의 `x` ([physics.js:593-598](../../src/resources/js/physics.js#L593-L598)) |
| 1 (점프 중) | `hit = 1` | 파워히트 발동 → `state = 2`, **이 순간의 `y`가 스매시 각도**(못박기/직선/강스매시)를 결정 | ([physics.js:581-587](../../src/resources/js/physics.js#L581-L587)) |
| 아무 상태 | `x = -1 / 1` | 좌우 이동 (관성 없음 — 그 프레임 즉시 속도 결정) |
| 3 (다이빙 중) | (입력 무시) | 다이빙 궤적 그대로 진행, 착지하면 `state = 4` |

- **키를 계속 누르고 있는 것처럼 값을 계속 보내도 안전하다.** 예를 들어 `hit=1`을 여러 틱 연속으로
  반환해도, `state`가 바뀌는 순간 위 표의 조건 자체가 더 이상 성립하지 않으므로 중복 발동되지
  않는다(예: 파워히트 진입 즉시 `state`가 1→2가 되어 더 이상 "점프 중" 조건에 안 걸림). 사람 키보드에만
  있는 "눌렀다 뗐다" 엣지 트리거 규칙은 봇 프로토콜엔 없다.
- **`x`의 부호는 스매시 방향을 조종하지 않는다.** 공이 어느 쪽으로 튈지는 네트 기준 어느 쪽에서
  맞았는지로 엔진이 정하고, 파워히트 순간의 `x≠0`은 그냥 타구 속도를 더 빠르게 만든다 (5절 예시
  코드의 주석 참고).
- **응답에는 구조적으로 약 1틱(`tickFrameGroupSize=1`이면 ~40ms) 지연이 있다.** 메인 스레드가 Worker
  응답을 그 틱 안에서 기다릴 수 없기 때문 — 버그가 아니라 이 아키텍처의 특성이다
  (자세한 내용: [03-bot-integration.md §1](./03-bot-integration.md#1-새로운-입력-경로)).

## 6. 예시 코드

세 개의 완성된 예시가 이미 있다. 전략을 참고하거나 그대로 복사해서 시작점으로 써도 된다.

### 6.1 추격형 (chase) — UI의 "Load example bot" 버튼이 불러오는 것

파일: [`bot/exampleBots.js`](../../src/resources/js/bot/exampleBots.js) (`CHASE_BOT_SOURCE`).
`ball.expectedLandingPointX`를 쫓아가다가, 점프해서 닿을 수 있으면 파워히트를 시도한다. 네트에
가까우면 급강하 스매시(`y=1`), 멀면 아치형으로 넘기는 못박기(`y=-1`)를 고른다. `tickCounter` 변수로
100틱마다 한 번씩 상태를 `console.log`로 찍는 디버깅 예시도 포함.

### 6.2 논힛(no-hit) 포지셔닝형

파일: [`docs/agent-dev/example-bots/no_hit_positioning_bot.js`](../agent-dev/example-bots/no_hit_positioning_bot.js).
`hit`을 항상 0으로 둬서 파워히트/다이빙을 아예 안 쓰고, 몸으로 공 진로에 들어가는 것만으로 받아친다.
공이 자기 코트로 오는 중이 아니면 코트 중앙으로 물러나 대기하는 로직, 그리고 헛점프를 막기 위해
"공이 x축으로 딱 맞고, 옆으로 너무 빠르지 않고, 확실히 높이 있을 때"만 점프하는 로직이 기본 AI의
점프 판단 로직을 참고해서 들어있다.

### 6.3 파워히트형

파일: [`docs/agent-dev/example-bots/power_hit_bot.js`](../agent-dev/example-bots/power_hit_bot.js).
6.1의 추격형과 거의 같은 전략을 더 간결하게 정리한 버전 — 참고용으로 나란히 두고 비교해봐도 좋다.

## 7. 자주 막히는 지점

- **"에러: undefined"만 뜨고 원인을 모르겠다** → 대개 `decide`라는 이름의 최상위 함수가 없는
  경우다(오타, 함수를 다른 이름으로 정의, `export`를 써서 문법 오류가 난 경우 등). 코드 맨 위에
  `function decide(s) { ... }`가 그대로 있는지 확인.
- **Apply를 눌렀는데 아무것도 안 바뀐 것 같다** → 정상이다. 인트로로 리셋된 뒤 메뉴를 통과해 다음
  랠리가 시작돼야 적용된다 (2절 3번).
- **봇이 반응이 한 박자 느린 것 같다** → 설계상 있는 ~1틱 지연이다 (5절 마지막 항목), 버그 아님.
- **점프/파워히트가 씹히는 것 같다** → `self.state`를 안 보고 있을 가능성이 크다. 점프는 `state===0`
  일 때만, 파워히트는 `state===1`일 때만 실제로 발동한다(5절 표) — 조건 없이 매 틱 `y=-1`이나
  `hit=1`을 반환해도 엔진이 조건에 안 맞으면 그냥 무시한다.
- **로그가 안 보이거나 너무 빨리 지나간다** → 3.1절 참고. 매 틱(초당 25번) 그대로 찍으면 못 읽으니
  `tickCounter % N`으로 주기를 줄이고, 그래도 안 보이면 메인 콘솔이 아니라 Worker 자체 콘솔을
  봐야 한다.
