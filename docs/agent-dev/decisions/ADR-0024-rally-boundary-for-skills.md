# ADR-0024 — 랠리 경계 판정 정정 (공이 떨어진 뒤에도 게이지가 차던 버그)

| | |
|---|---|
| 상태 | **RESOLVED (회의 승인 전)** — 의도된 규칙 복구이며 밸런스 수치는 건드리지 않음 |
| 결정일 | 2026-08-11 |
| 결정자 | imtmtl (발견) / 구현: Claude Code — 정기 회의 승인 전 |
| 반영 | `skill/rally.js`(신규 `isRallyLive`), `skill/gauge.js`(`observe`), `skill/claw.js`(`tryCast`·`observe`) — Issue #14, 브랜치 `feature/14-rally-boundary-gauge-claw` |
| 관련 | [ADR-0020](ADR-0020-gauge-system.md) §구현(랠리 경계 가정 정정), [ADR-0021](ADR-0021-claw-skill.md) §4-4, [CONTRACTS.md](../CONTRACTS.md) §1.1 |

## 배경

공이 땅에 떨어져 점수가 난 뒤 다음 랠리가 시작되기 전까지, **그 사이에 공을 치면 게이지가 계속
찼다**(팀장 발견). 의도는 [ADR-0020](ADR-0020-gauge-system.md)대로 "랠리 중의 접촉"만 충전하는
것이므로 이는 규칙 변경이 아니라 **구현이 의도를 벗어난 버그**다.

원인은 랠리 종료 판정이다. ADR-0020 §구현은 "`round` 상태를 벗어나면(랠리 종료) `lastToucherIndex`를
`null`로 리셋한다"고 적었고 `skill/gauge.js`도 그대로 `pikaVolley.state !== pikaVolley.round`로
판정했다. **이 가정이 틀렸다** — `round()`는 공이 땅에 닿은 뒤에도 계속 돈다:

- 착지 시 `roundEnded = true`, `slowMotionFramesLeft = 6` ([`pikavolley.js:396-398`](../../../src/resources/js/pikavolley.js#L396-L398))
- `state = afterEndOfRound`로 넘어가는 건 그 6프레임을 다 쓴 뒤 ([`pikavolley.js:403-405`](../../../src/resources/js/pikavolley.js#L403-L405))
- `slowMotionFPS = 5`이므로 6프레임 = **체감 약 1.2초**. 그동안 `runEngineForNextFrame`은 계속
  호출되고([`pikavolley.js:345`](../../../src/resources/js/pikavolley.js#L345)) 공 접촉 플래그도 계속 선다.

같은 뿌리에서 두 번째 창이 있다. `runEngineForNextFrame` 호출이 `gameEnded` early-return
([`pikavolley.js:353-365`](../../../src/resources/js/pikavolley.js#L353-L365))보다 **위에** 있어서,
승패 메시지가 떠 있는 동안에도 물리가 돌고 게이지가 찼다. 게이지는 경기 시작 시 리셋되므로
다음 경기로 새지는 않지만 원인은 동일하다.

claw도 **같은 게이트를 복사해 쓰고 있었다**(`claw.js`의 `tryCast`·`observe`). 즉 점수가 확정된
뒤 1.2초 안에 발톱을 발동하거나 명중시킬 수 있었다. [CONTRACTS.md](../CONTRACTS.md) §1.1은 이미
"**랠리 밖** 발동은 조용히 실패"라고 규정하고 있었으므로, 이 건은 문서가 맞고 코드가 틀린 경우다.

## 결정

랠리가 살아 있다는 판정을 **한 곳으로 모으고**, 정의를 아래로 정정한다.

```js
// skill/rally.js
state === round && roundEnded === false && gameEnded === false
```

- **새 모듈 `skill/rally.js`의 `isRallyLive(pikaVolley)` 하나만 쓴다.** 게이지와 claw가 각자
  판정하다 한쪽만 고쳐지는 걸 막기 위해서다. 앞으로 추가되는 스킬도 이걸 쓸 것.
- `gauge.js observe`: `isRallyLive`가 거짓이면 충전하지 않고 `lastToucherIndex`를 리셋한다
  (다음 접촉이 서브가 되는 기존 동작은 그대로).
- `claw.js tryCast`: 랠리 밖 발동은 실패하며 **게이지는 소모되지 않는다**(CONTRACTS §1.1 그대로).
- `claw.js observe`: 랠리가 끝나면 예고 중인 발톱을 취소한다. 이미 지불한 게이지는
  [ADR-0021 §4-4](ADR-0021-claw-skill.md)대로 환불하지 않는다.

### 연습 모드는 영향 없음

`roundEnded`는 `_isPracticeMode === false`일 때만 세팅된다([`pikavolley.js:367-372`](../../../src/resources/js/pikavolley.js#L367-L372)).
따라서 연습 모드에서는 `isRallyLive`가 계속 참이고, "연습 모드에서도 게이지는 그대로 동작한다"는
[ADR-0020](ADR-0020-gauge-system.md) §트레이드오프가 유지된다.

### CONTRACTS.md 버전은 올리지 않는다

[VERIFY.md](../VERIFY.md) §4 기준으로 판단했다. 스냅샷 필드도 `config` 값도 바뀌지 않고,
§1.1의 "랠리 밖 발동 실패" 문구는 이미 이 수정 후의 동작을 서술하고 있다. 즉 **계약 변경이 아니라
계약 준수**이므로 v0.7을 유지한다.

## 봇 밸런스에 주는 영향

충전 기회가 줄어든다 — 착지 후 1.2초 창에서 공을 긁어 게이지를 벌 수 없다. [ADR-0021
§5-1](ADR-0021-claw-skill.md)이 이미 "밸런스 수치는 봇 대전 기준으로 다시 잡아야 한다"고 적어둔
상태이므로, **회의에서 `CLAW_COST`/`CLAW_WIDTH`를 정할 때 이 수정 이후의 충전 속도를 기준으로 볼
것**. 수정 전 수치 감각은 참고치가 아니다.

## 아직 OPEN인 것

1. **`develop`에 게이지가 없다** — [AGENTS.md](../../../AGENTS.md) §5는 "게이지(Phase 4-A)까지는
   `develop`에 넣는다"고 적혀 있지만 실제 `origin/develop`에는 `src/resources/js/skill/`가 없고
   게이지는 `develop-skill`에만 있다. 게이지를 `develop`으로 올릴지, 아니면 §5 문구를 현실에 맞게
   고칠지는 **회의 안건**이다(AGENTS.md §5 마지막 줄: 임의로 다르게 운영하지 말고 파일부터 고칠 것).
2. **기절 중 랠리 종료** — 발톱에 맞아 기절한 상태로 랠리가 끝나면 `lyingDownDurationLeft`는
   엔진이 알아서 소진하지만, 다음 랠리 시작 시 기절이 남아 있을 수 있는지는 별도 확인이 필요하다.

## 트레이드오프

- **`roundEnded`/`gameEnded`는 엔진 내부 플래그를 밖에서 읽는 것**이다. 엔진 파일 무수정 원칙
  (ADR-0020 §구현)의 연장이며, 쓰기가 아니라 읽기이므로 위험은 낮다. 다만 원작 상태 머신이
  바뀌면 `rally.js` 한 파일만 따라가면 된다는 점이 이 구조의 이득이다.
- **슬로모션 6프레임 동안 화면에는 공이 여전히 움직인다.** 그 공을 쳐도 게이지가 안 오르는 것이
  플레이어에게는 살짝 어색할 수 있으나, 점수가 이미 확정된 뒤이므로 규칙상 올라서는 안 된다.
