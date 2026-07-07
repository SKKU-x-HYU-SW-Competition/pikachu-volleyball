# CONTRACTS.md — 에이전트 입출력 프로토콜 & 틱 타이밍 (SOR)

> **상태: DRAFT v0.1 — 아직 구현 전.** 이 문서가 이 프로토콜의 단일 진실 소스입니다.
> Phase 1(입력 구조 개편) 구현 코드는 이 문서에 정의된 필드/의미론과 항상 일치해야 하며,
> 반대로 구현하다가 이 문서와 다르게 가야 한다는 게 밝혀지면 **코드부터 바꾸지 말고
> 먼저 이 문서를 갱신 + 버전을 올리고 [DECISIONS.md](DECISIONS.md)에 사유를 남긴 뒤** 코드를 바꾸세요.
> "실전 검증 중 틱 길이 같은 걸 바꿀 수 있다"는 건 이미 논의된 전제입니다 — 확정 스펙이 아니라
> 계속 다듬어질 계약서라고 생각하세요.

## 0. 왜 이 문서가 SOR인가

에이전트 입출력 형식, enum 값, 틱 길이 같은 상수가 `pikavolley.js`, `physics.js`, 테스트 환경,
제출/중계 도구 등 여러 곳에 흩어져 각자 다르게 정의되면 트랙 간(특히 서로 다른 에이전트 도구를
쓰는 담당자 간) 구현이 어긋납니다. **이 값들은 이 문서에서만 정의하고, 실제 코드는 여기서 import/참조만
하도록 만드세요** (구현 단계에서 예: `src/resources/js/agentContract.js` 같은 단일 모듈에 상수/타입을
박아넣고, 다른 모든 모듈은 거기서 가져다 씀 — 같은 값을 두 번 정의하지 말 것).

## 1. 에이전트 입출력 프로토콜 (안)

기존 게임의 입력 인터페이스는 [`PikaUserInput`](../../src/resources/js/physics.js#L102-L111)
(`xDirection: -1|0|1`, `yDirection: -1|0|1`, `powerHit: 0|1`) 세 필드뿐입니다. 새 에이전트 입력 클래스는
**이 세 필드와 100% 호환**되어야 합니다 (그래야 `physics.runEngineForNextFrame(keyboardArray)`를
전혀 건드리지 않고 `keyboardArray` 원소만 교체해서 끼울 수 있음 — [AGENTS.md](../../AGENTS.md) §2 참고).

```
매 tick:
  snapshot = buildGameStateSnapshot(physics, frameInfo)   // 엔진 → 에이전트
  { xDirection, yDirection, powerHit } = agentFn(snapshot) // 참가자 코드 → 엔진
```

### 1.1 게임 상태 스냅샷에 포함될 값 (초안 — 미확정)

물리 엔진에 이미 존재하는 필드를 그대로 노출하는 것을 기본 원칙으로 합니다 (새 값을 지어내지 않음):

- **self / opponent** (각각 [`Player`](../../src/resources/js/physics.js#L124) 기준):
  `x`, `y`, `yVelocity`, `state`(0정상/1점프/2파워히트/3다이빙/4누움/5승리/6패배), `frameNumber`,
  `isPlayer2`, `divingDirection`
- **ball**: `x`, `y`, `xVelocity`, `yVelocity`, `punchEffectX`
- **경기 메타**: `scores`, `frameCounter` 혹은 이번 랠리 경과 프레임, `isPlayer2Serve`
- **미정**: 상대방 필드까지 전부 노출할지(완전 정보) vs 일부만 줄지, 과거 N틱 히스토리를 줄지 여부
  → [DECISIONS.md](DECISIONS.md) D-003 참고

### 1.2 반환값 검증 규칙 (미정)

- 범위를 벗어난 값(예: `xDirection: 5`)이나 타입이 틀린 값을 반환하면 어떻게 처리할지
  (0,0,0으로 무시 / 이전 값 유지 / 실격) → 미정, [DECISIONS.md](DECISIONS.md) D-002

## 2. 타이밍 / 틱 상수 (안)

원작 기준 실측값 (모두 [`pikavolley.js`](../../src/resources/js/pikavolley.js), [`main.js`](../../src/resources/js/main.js) 근거):

| 항목 | 값 | 근거 |
|---|---|---|
| 평상시 FPS | 25 | `pikavolley.js:54` `normalFPS = 25` |
| 평상시 1 tick 길이 | **40ms** | `1000/25` |
| 슬로모션 FPS | 5 | `pikavolley.js:56` `slowMotionFPS = 5` |
| 슬로모션 지속 프레임 수 | 6 | `pikavolley.js:59` `SLOW_MOTION_FRAMES_NUM = 6` (골 직후에만 발동) |
| 틱 구동 방식 | PixiJS `Ticker`, `ticker.maxFPS = normalFPS` | `main.js:154-161` |

**에이전트 연산 예산 (미정)**: 기본값은 "1 tick(=1 프레임=40ms) 안에 에이전트 함수가 값을 반환해야 함"
이지만, 실제로 너무 타이트하다고 검증되면 **"N 프레임을 묶어서 1 틱으로 취급"** (예: 3프레임=1틱=120ms
동안 같은 입력 유지) 식으로 조정할 수 있다는 게 이미 논의됨. 이 값(N)과 시간초과 시 처리(이전 입력
유지 vs 무입력)는 확정 전까지 **DRAFT**이며, 실제로 확정되기 전까지는 코드에서 `TICK_FRAME_GROUP_SIZE = 1`
같은 이름의 단일 상수로 빼두고 다른 곳에서 하드코딩하지 마세요. → [DECISIONS.md](DECISIONS.md) D-001

## 3. 변경 이력

| 버전 | 날짜 | 변경자 | 내용 |
|---|---|---|---|
| v0.1 | 2026-07-07 | (agent-settings 초기 세팅) | 최초 작성. 프로토콜/타이밍 모두 DRAFT, 구현 전 |
