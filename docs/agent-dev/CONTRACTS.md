# CONTRACTS.md — 봇 입출력 프로토콜 & 틱 타이밍 (SOR)

> **상태: DRAFT v0.3 — 아직 구현 전.** 이 문서가 이 프로토콜의 단일 진실 소스입니다.
> Phase 1(입력 구조 개편) 구현 코드는 이 문서에 정의된 필드/의미론과 항상 일치해야 하며,
> 반대로 구현하다가 이 문서와 다르게 가야 한다는 게 밝혀지면 **코드부터 바꾸지 말고
> 먼저 이 문서를 갱신 + 버전을 올리고 [DECISIONS.md](DECISIONS.md)에 사유를 남긴 뒤** 코드를 바꾸세요.
> "실전 검증 중 틱 길이 같은 걸 바꿀 수 있다"는 건 이미 논의된 전제입니다 — 확정 스펙이 아니라
> 계속 다듬어질 계약서라고 생각하세요.
>
> 용어: 참가자가 짜오는 코드를 **bot**이라고 부릅니다 (이전에 "에이전트"라고 부르던 것과 동일).

## 0. 왜 이 문서가 SOR인가

봇 입출력 형식, enum 값, 틱 길이 같은 상수가 `pikavolley.js`, `physics.js`, 테스트 환경,
제출/중계 도구 등 여러 곳에 흩어져 각자 다르게 정의되면 트랙 간(특히 서로 다른 에이전트 도구를
쓰는 담당자 간) 구현이 어긋납니다. **이 값들은 이 문서에서만 정의하고, 실제 코드는 여기서 import/참조만
하도록 만드세요** (구현 단계에서 예: `src/resources/js/agentContract.js` 같은 단일 모듈에 상수/타입을
박아넣고, 다른 모든 모듈은 거기서 가져다 씀 — 같은 값을 두 번 정의하지 말 것).

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
매 tick:
  snapshot = buildGameStateSnapshot(physics, frameInfo)     // 엔진 → 봇
  postMessage(worker, snapshot)                             // 메인 스레드 → 봇 Worker (D-003, §1.3)
  { x, y, hit } = await response within timeout, else neutral // 봇 Worker → 메인 스레드 (D-002)
  그대로 xDirection/yDirection/powerHit로 전달
```

### 1.1 봇 출력 (봇 → 엔진)

```json
{ "x": -1, "y": 1, "hit": 1 }
```

| 필드 | 값 | 의미 | 엔진 매핑 |
|---|---|---|---|
| `x` | -1 / 0 / 1 | 왼쪽 / 중립 / 오른쪽 | `PikaUserInput.xDirection` 그대로 |
| `y` | -1 / 0 / 1 | 위 / 중립 / 아래. 땅에서 -1은 점프, 공중 파워히트 순간엔 스매시 각도(못박기/직선/강스매시) | `PikaUserInput.yDirection` 그대로 |
| `hit` | 0 / 1 | 파워히트(공중) 또는 다이빙(지상+`x≠0`) | `PikaUserInput.powerHit` 그대로 |

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
  "self":  { "x": 120, "y": 244, "state": 0, "frameNumber": 3, "divingDirection": 0 },
  "opp":   { "x": 300, "y": 180, "state": 1, "frameNumber": 5, "divingDirection": 0 },
  "ball":  { "x": 216, "y": 140, "xVelocity": -3, "yVelocity": 6, "expectedLandingPointX": 340, "isPowerHit": false },
  "meta":  { "score": { "self": 7, "opp": 6 }, "isPlayer2Serve": false, "rallyFrameCount": 42 },
  "config": { "tickFrameGroupSize": 1 }
}
```

필드 출처 (전부 물리 엔진에 이미 있는 값 — 새로 지어낸 값 없음):

- **self / opp** ([`Player`](../../src/resources/js/physics.js#L124) 기준): `x`, `y`,
  `state`(0정상/1점프/2파워히트/3다이빙/4누움/5승리/6패배), `frameNumber`, `divingDirection`.
  둘 다 **완전 대칭 정보**를 줍니다 (상대 정보를 숨기지 않음 — 실제로도 사람이 화면을 보면 다
  보이는 정보이므로 인위적으로 가릴 이유가 없다고 판단).
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
  봇이 `tick * 40 * tickFrameGroupSize`로 직접 계산하면 됩니다.

### 1.3 실행 모델: Web Worker 격리 (결정: D-003)

봇 코드는 메인 스레드에서 `eval`/동적 `import`로 직접 돌리지 않고, **별도의 Web Worker**에서
실행합니다. 이유: 메인 스레드에서 직접 돌리면 봇 코드의 무한루프/과도한 연산이 렌더링과 상대방
입력까지 포함한 게임 전체를 멈춰버리고, 동기 코드는 밖에서 강제로 끊을 방법이 없습니다.

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

## 2. 타이밍 / 틱 상수

원작 기준 실측값 (모두 [`pikavolley.js`](../../src/resources/js/pikavolley.js), [`main.js`](../../src/resources/js/main.js) 근거):

| 항목 | 값 | 근거 |
|---|---|---|
| 평상시 FPS | 25 | `pikavolley.js:54` `normalFPS = 25` |
| 평상시 1 프레임 길이 | **40ms** | `1000/25` |
| 슬로모션 FPS | 5 | `pikavolley.js:56` `slowMotionFPS = 5` |
| 슬로모션 지속 프레임 수 | 6 | `pikavolley.js:59` `SLOW_MOTION_FRAMES_NUM = 6` (골 직후에만 발동) |
| 틱 구동 방식 | PixiJS `Ticker`, `ticker.maxFPS = normalFPS` | `main.js:154-161` |

**봇 연산 예산 (결정: D-001)**: `tickFrameGroupSize = 1` (1 프레임 = 1 틱 = 40ms)로 확정. `gameLoop()`은
`deltaTime` 보정 없이 "호출 1번 = 프레임 1개 전진"하는 구조라([`main.js:156-158`](../../src/resources/js/main.js#L156-L158))
계산이 40ms를 넘겨도 게임이 깨지거나 desync되지 않고 체감 fps만 잠깐 떨어집니다 — 규칙 기반 로직
(비교/분기 몇 개)은 마이크로초 단위라 40ms에 압도적으로 여유가 있고, 진짜 위험(무한루프로 메인
스레드가 멈추는 것)은 틱을 늘려도 해결되지 않으므로 §1.3(D-003, Worker 격리)와 D-002(무입력 폴백)로
따로 대응합니다. 나중에 학습 기반 봇의 매틱 추론 비용이 Phase 2 실측에서 실제로 문제가 되면 그때
`tickFrameGroupSize`를 올리는 쪽으로 재논의하세요 — 지금은 값 자체는 확정이지만, 상수로 빼두고
(`agentContract.js`의 `TICK_FRAME_GROUP_SIZE`처럼) 하드코딩하지 않아 나중에 바꾸기 쉽게 해두는 것까지가
이번 결정의 일부입니다.

시간초과/잘못된 반환값 처리는 §1.1에서 무입력으로 확정했습니다 (D-002).

## 3. 변경 이력

| 버전 | 날짜 | 변경자 | 내용 |
|---|---|---|---|
| v0.1 | 2026-07-07 | (agent-settings 초기 세팅) | 최초 작성. 프로토콜/타이밍 모두 DRAFT, 구현 전 |
| v0.2 | 2026-07-07 | (agent-settings 초기 세팅) | 용어를 "에이전트"→"bot"으로 통일. 출력을 4-bit(`left/right/jump/spike`)에서 엔진과 1:1 대응하는 3필드(`x/y/hit`)로 변경. 좌표계를 원본 정수 픽셀 그대로 쓰기로 확정(D-007). `expectedLandingPointX` 노출 확정(D-006). 세트제 미도입 확정, `meta.set/max_set` 제거(D-008). `decision_interval_ms`/`max_response_ms`를 `config.tickFrameGroupSize` 하나로 통합 |
| v0.3 | 2026-07-07 | Claude Code (사용자 승인) | `tickFrameGroupSize = 1` 확정(D-001). 시간초과/잘못된 반환값 처리를 무입력으로 확정(D-002). 실행 모델을 Web Worker 격리(+타임아웃+강제종료 후 재시작)로 확정(D-003), §1.3 신설 |
