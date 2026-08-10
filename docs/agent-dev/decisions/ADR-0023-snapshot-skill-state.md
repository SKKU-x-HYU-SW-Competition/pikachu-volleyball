# ADR-0023 — 스냅샷에 게이지·claw 예고·튜닝 상수 노출 (Phase 4-B-2)

| | |
|---|---|
| 상태 | **RESOLVED (회의 승인 전)** — 필드 구성·배치·의미론 확정 |
| 결정일 | 2026-08-11 |
| 결정자 | imtmtl (구현: Claude Code) — 정기 회의 승인 전이며, 회의에서 뒤집히면 이 표를 갱신할 것 |
| 반영 | [CONTRACTS.md](../CONTRACTS.md) **v0.7** §1.2, `bot/botContract.js`(`buildGameStateSnapshot`), `bot/botInput.js`, `bot/testSetup.js`, `skill/setup.js`(`setUpSkills`), `skill/gauge.js`·`skill/claw.js`(상수 export), `main.js`, `code/exampleBots.js` — Issue #12, 브랜치 `feature/12-snapshot-skill-state` |

## 배경

[ADR-0022](ADR-0022-bot-skill-action-field.md)로 봇은 `skillX`로 **발동**은 할 수 있게 됐지만,
스냅샷에는 스킬 관련 정보가 하나도 없었다. 그래서 봇은

- 자기 게이지를 몰라 **언제 발동 가능한지 모르고** (실패는 조용히 무시된다),
- 상대 게이지를 몰라 **언제 맞을 위험이 큰지 모르고**,
- 예고 중인 발톱을 못 봐서 **회피가 구조적으로 불가능**했다.

사람은 화면을 보고 다 알 수 있는 정보이므로 현 상태는 봇에게 일방적으로 불리하고,
[ADR-0021 §5](ADR-0021-claw-skill.md)·[ADR-0020](ADR-0020-gauge-system.md) 둘 다 이걸 OPEN으로
남겨두고 "그전까지 봇 대전 밸런스 판단은 보류"라고 못박아 뒀다. 이 ADR이 그 항목을 해소한다.

## 결정

### 1. 게이지는 `self.gauge` / `opp.gauge` (플레이어 뷰 안)

[ADR-0020 §OPEN-3](ADR-0020-gauge-system.md)이 예고한 배치 그대로다. 게이지는 "플레이어가 들고
있는 값"이므로 `x`/`y`/`state`와 같은 자리에 두는 게 자연스럽고, `self`/`opp` 정렬을 스냅샷 빌더가
이미 하고 있어서 봇이 `side`를 보고 인덱스를 뒤집을 필요가 없다.

**상대 게이지도 그대로 보여준다.** §1.2의 "완전 대칭 정보" 원칙(상대 정보를 숨기지 않음)과 같은
이유다 — 화면의 게이지 바에 이미 양쪽 다 그려져 있으므로 봇에게만 가릴 근거가 없다.

### 2. 예고 중인 발톱은 `self.claw` / `opp.claw` (**시전자 기준**)

```json
"opp": { "...": "...", "claw": { "centerX": 120, "framesUntilStrike": 12, "framesLeftActive": 0 } }
```

`claw`는 **그 플레이어가 시전한** 발톱이다. 「claw」의 피해자는 항상 시전자의 상대이므로
([`skill/claw.js`](../../../src/resources/js/skill/claw.js)의 `strike(claw, players[1 - i])`),

- **`opp.claw` = 나를 노리는 발톱** → 회피 판단에 쓰는 값
- **`self.claw` = 내가 쏜 발톱** → `null`이 아니면 재발동이 거절된다(슬롯 점유 확인용)

"피해자 기준"(`self.incomingClaw`)으로 두는 안도 검토했으나, 그러면 `self.claw`가 사라져서 봇이
자기 슬롯이 비었는지 알 방법이 없어진다. 시전자 기준 하나로 두 용도를 다 덮는다.

발동 중이 아니면 `null`이다(Python에서는 `None`).

| 하위 필드 | 의미 |
|---|---|
| `centerX` | 발톱 범위의 중심 x (물리 px) |
| `framesUntilStrike` | 발톱이 터지기까지 남은 프레임. `0`이면 이미 터졌고 연출만 남은 상태 |
| `framesLeftActive` | 연출이 사라지기까지 남은 프레임. `0`까지 떨어지면 슬롯이 비어 재발동 가능 |

`isWithinClaw()`가 그렇듯 판정은 **x축만** 보므로, 봇이 맞는 조건은
`|self.x - opp.claw.centerX| <= config.claw.width / 2 + 32`(32 = `PLAYER_HALF_LENGTH`)이다.
이 식을 스냅샷이 대신 계산해서 `willBeHit` 같은 불리언으로 주는 안은 채택하지 않았다 — 회피
여부를 판단하는 것 자체가 이 스킬의 전략이고, 미리 계산해 주면 [D-006](ADR-0006-expose-expected-landing-point.md)의
`expectedLandingPointX`와 달리 "재구현 비용"이 아니라 "전략 변별력"을 깎는다. 대신 계산에 필요한
재료(`centerX`, `width`, `PLAYER_HALF_LENGTH`)는 전부 준다.

### 3. 튜닝 상수를 `config`로 함께 노출

```json
"config": {
  "tickFrameGroupSize": 3,
  "gauge": { "min": 0, "max": 100, "onReceive": 10, "onExtraTouch": -5, "onServe": 0 },
  "claw":  { "cost": 50, "width": 96, "warningFrames": 25, "stunFrames": 25, "activeFrames": 10 }
}
```

`CLAW_COST`·`CLAW_WIDTH`·게이지 증감폭은 전부 [ADR-0021 §3](ADR-0021-claw-skill.md)의 **stub이고
"실측 후 조정 1순위"** 로 적혀 있다. 문서에만 적어두면 참가자 봇은 이 값을 소스에 하드코딩하게
되고, 회의에서 숫자를 바꾸는 순간 **모든 봇이 조용히 틀린 판단**을 하게 된다(에러도 안 난다).
게임 밖 상수를 매 틱 실어 보내는 비용(정적 객체 하나)보다 이쪽 위험이 훨씬 크다고 봤다.

`config.claw.stunFrames`는 **실제 기절 지속 프레임 수(25)** 다. 소스의 `CLAW_STUN_FRAMES`(23)는
엔진이 `lyingDownDurationLeft`를 N+2 프레임 동안 쓰기 때문에 나온 내부 값이라 그대로 노출하면
봇이 2프레임을 틀리게 센다.

`config.claw`처럼 **스킬 이름을 키로** 두었다(중간에 `skill` 한 겹을 더 넣지 않음). 두 번째 스킬이
생기면 `config.<스킬명>`이 하나 늘어난다.

### 4. `lyingDownDurationLeft`를 플레이어 뷰에 추가

기절/누움이 언제 풀리는지는 `state === 4`만으로는 알 수 없다. 이 필드는 원본 `Player`의 공개
필드이므로 [D-007](ADR-0007-coordinate-system.md)의 "엔진 값을 지어내지 않고 그대로" 원칙에 맞고,
"움직일 수 있게 되기까지 `값 + 2` 프레임"이라는 해석만 문서에 적어두면 된다. 파생값으로 바꿔서
내보내지 않은 이유는 같은 원칙 때문이다(`stunFrames`는 봇이 알 수 없는 내부 관례라 예외).

### 5. 값의 시점: 직전 프레임 종료 시점

게이지/발톱 트래커는 `gameLoop()` **뒤에** 관찰하고([ADR-0020 §5](ADR-0020-gauge-system.md)),
스냅샷은 `getInput()` 안 = `gameLoop()` **도중**에 만들어진다. 즉 스냅샷의 스킬 값은 **직전 프레임이
끝난 시점**의 값이다. 나머지 필드(공/플레이어 좌표)도 같은 시점이므로 스냅샷 안에서 시점이
어긋나지는 않는다.

여기에 [D-009](ADR-0009-worker-async-latency.md)의 파이프라인 지연(약 1틱)과
`tickFrameGroupSize`(3프레임)가 더해지므로, 봇이 실제로 반응할 수 있는 여유는
`framesUntilStrike`보다 **최대 6프레임 정도 짧다**. 예고 25프레임이면 충분하지만, 참가자 가이드에
"마지막 몇 프레임을 믿지 말 것"으로 적었다.

### 6. 배선: `main.js`에서 스킬 트래커를 봇 UI보다 먼저 만든다

스냅샷 빌더가 게이지/발톱을 읽으려면 `PikaBotInput`이 트래커에 닿아야 하는데, 기존 `main.js`는
`setUpBotTestUI()` → `start()` → `setUpGauge()`/`setUpClaw()` 순서라 트래커가 봇 UI보다 **뒤에**
생겼다.

그래서 `skill/setup.js`를 `setUpSkills(pikaVolley, resources)` 하나로 합치고, **생성(트래커·뷰·키
리스너)** 과 **관찰 배선(`startObserving(ticker)`)** 을 쪼갰다. 생성은 봇 UI보다 먼저,
ticker 등록은 `start()` 뒤에 하면 "관찰은 `gameLoop()` 뒤"라는 기존 순서가 그대로 유지된다.
콜백 하나로 합쳐졌지만 내부 실행 순서(게이지 관찰 → 게이지 그리기 → 봇 발동 → 발톱 관찰 → 발톱
그리기)는 기존 두 콜백의 순서와 동일하다.

트래커를 전역 싱글턴 모듈로 빼서 아무 데서나 import하는 안은 안 썼다 — `getMeta`처럼 **주입**으로
넘기면 의존 방향이 눈에 보이고(`main.js` → `testSetup` → `PikaBotInput`), 테스트에서 가짜 상태를
넣기도 쉽다.

### 7. 하위 호환

기존 3필드 봇은 **무변경으로 계속 동작한다**. 스냅샷에 필드가 추가되기만 했고 제거·개명된 필드는
없다. 배선이 안 된 경로(`getSkillState` 미주입)에서는 `gauge`/`claw`가 `null`, `config.gauge`/
`config.claw`가 `null`로 나가고 나머지 스냅샷은 그대로다 — 봇이 죽지 않게 하는 stub이며, 실제
게임에서는 `main.js`가 항상 주입한다.

## 아직 OPEN인 것

1. **밸런스** — 이제서야 봇이 회피할 수 있게 됐으므로, `CLAW_WIDTH`(96)·`CLAW_COST`(50)·
   `CLAW_WARNING_FRAMES`(25)의 실측 조정은 **봇 대전으로** 다시 해야 한다. 사람 기준으로 잡은
   감각은 참고치에 불과하다.
2. **두 번째 스킬** — [ADR-0021 §5-2](ADR-0021-claw-skill.md) 그대로 남아 있다. `config`가
   스킬명을 키로 갖는 형태라 스킬이 늘어도 스냅샷 구조는 안 바뀐다.
3. **`meta.rallyFrameCount`와 스킬 쿨다운의 관계** — 랠리를 벗어나면 예약된 발톱이 취소되는데
   (게이지는 환불 없음), 봇이 "지금 발동해도 랠리가 끝나서 날아갈지"를 판단할 재료는 아직 없다.
   현재로선 랠리 종료 직전 발동은 그냥 손해다.

## 트레이드오프

- **스냅샷이 커졌다.** 플레이어당 3필드 + `config` 두 블록. 매 틱 `postMessage`로 구조화 복제되고
  Python 쪽은 `to_py()`까지 거치므로 공짜는 아니다. 다만 전부 얕은 객체이고 틱은 120ms라
  실측상 문제되는 규모가 아니다 — 커지면 `config`를 `init` 시점 1회 전송으로 옮기는 게 다음 수다.
- **`config`에 게임 밸런스 수치가 실려 나간다.** 참가자가 대회 당일 바뀐 숫자를 코드 수정 없이
  읽을 수 있다는 뜻이고, 이건 "현장에서 새 스킬 공개 → 즉석 대응"이라는 대회 포맷에 오히려 맞다고
  판단했다.
- **`self.claw`/`opp.claw`가 시전자 기준**이라 "나를 노리는 발톱"이 `opp` 쪽에 있다. 처음 보면
  헷갈릴 수 있어 가이드 문서와 예제 봇에 주석으로 명시했다.
