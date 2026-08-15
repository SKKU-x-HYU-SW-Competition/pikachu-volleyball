# 예제 2: Positioning — 파워히트 없이 몸으로만 막기

**목표**: 파워히트(`hit`)를 한 번도 쓰지 않고, **오직 위치잡기**만으로 공을
넘기는 봇. `expectedLandingPointX`를 어떻게 활용하는지, 왜 "공 바로 밑"이 아니라
"공 옆쪽"에 서야 하는지, 언제 점프하고 언제 참아야 하는지를 다룹니다.

## 왜 이렇게 짜는가 (핵심 아이디어)

### 1. 파워히트를 안 써도 공은 넘어갑니다

원작의 물리 엔진은 파워히트가 아니어도 **몸에 공이 닿으면 튕겨냅니다**. 다만
튕겨나가는 방향이 파워히트처럼 조준되지 않고, **공이 내 몸 중심의 어느 쪽에
닿았는가**로 결정됩니다:

- 공이 내 왼쪽에 닿으면 → 공이 왼쪽으로 튐
- 공이 내 오른쪽에 닿으면 → 공이 오른쪽으로 튐

그래서 "공 밑에 정확히 서면" 공이 위로 곧장 튕겨나가 다시 내 코트로 떨어질
확률이 높습니다. **약간 옆으로 비켜 서서** 몸의 "네트쪽 면"으로 공을 받으면
네트 방향으로 튕겨나갑니다.

### 2. 상대 코트에 공이 있을 땐 참기

`expectedLandingPointX`를 무작정 따라다니면, 공이 상대 코트에 있을 때도 네트
바로 앞에 붙어 있게 됩니다. 상대가 공을 받아 넘긴 순간 반응하기엔 그 위치가
너무 앞이라 후속 대응이 어렵습니다.

→ **공이 상대 코트에 예상 낙하 중이면, 낙하지점 대신 내 코트 중앙으로 후퇴**해서
대기합니다. (원작 내장 AI가 하는 것과 같은 방식)

### 3. 점프 조건은 엄격하게

플레이어 서 있을 때 상하 32픽셀 범위 안에 공이 들어오면 이미 몸으로 받힌
걸로 처리됩니다. "공이 좀 위에 있다" 정도로 점프해봤자 착지하는 순간 공이
지나가버립니다. 그래서 점프는 다음 조건을 **전부** 만족할 때만:

- 공의 x좌표가 내 히트박스 안에 있음 (32픽셀 이내)
- 공의 옆속도가 크지 않음 (내가 뛰어올랐을 때도 여전히 위에 있을 것)
- 공이 진짜 높이 있음 (y < 150)
- 공이 내려오는 중 (yVelocity > 0)

## JavaScript

`src/code-here/Positioning_v1.js`:

```js
'use strict';

function decide(s) {
  var NET_X = 216;              // GROUND_HALF_WIDTH
  var GROUND_WIDTH = 432;
  var PLAYER_HALF_LENGTH = 32;
  var towardNet = s.side === 'RIGHT' ? -1 : 1;

  var ownNearBoundary = s.side === 'RIGHT' ? NET_X : 0;
  var ownFarBoundary  = s.side === 'RIGHT' ? GROUND_WIDTH : NET_X;
  var standbyX = (ownNearBoundary + ownFarBoundary) / 2;

  var landingOnOwnSide =
    s.ball.expectedLandingPointX > ownNearBoundary &&
    s.ball.expectedLandingPointX < ownFarBoundary;

  var targetX;
  if (landingOnOwnSide) {
    // 공이 진짜 우리 쪽으로 온다 -- 낙하지점보다 살짝 "네트 반대쪽"에 서서
    // 몸의 네트쪽 면으로 공을 받는다 (=> 공이 네트 쪽으로 튀어나감).
    targetX = s.ball.expectedLandingPointX - towardNet * 12;
  } else {
    // 아직 상대 쪽에 있다 -- 뒤로 물러나 대기.
    targetX = standbyX;
  }

  var dx = targetX - s.self.x;
  var x = 0;
  if (Math.abs(dx) > 6) {
    x = dx > 0 ? 1 : -1;
  }

  // 점프 조건: 엄격하게 (윗해설 참고)
  var y = 0;
  var xAligned = Math.abs(s.ball.x - s.self.x) < PLAYER_HALF_LENGTH;
  var ballSlowSideways = Math.abs(s.ball.xVelocity) < 5;
  var ballClearlyHigh = s.ball.y < 150;
  if (
    s.self.state === 0 &&
    xAligned &&
    ballSlowSideways &&
    ballClearlyHigh &&
    s.ball.yVelocity > 0
  ) {
    y = -1;   // 점프 = 땅에서 y = -1
  }

  // hit은 항상 0 -- 파워히트도, 다이빙도 없음.
  return { x: x, y: y, hit: 0 };
}
```

## Python

`src/code-here/Positioning_v1.py`:

```python
def decide(s):
    NET_X = 216
    GROUND_WIDTH = 432
    PLAYER_HALF_LENGTH = 32
    toward_net = -1 if s['side'] == 'RIGHT' else 1

    own_near = NET_X if s['side'] == 'RIGHT' else 0
    own_far  = GROUND_WIDTH if s['side'] == 'RIGHT' else NET_X
    standby_x = (own_near + own_far) / 2

    landing_on_own_side = (
        s['ball']['expectedLandingPointX'] > own_near
        and s['ball']['expectedLandingPointX'] < own_far
    )

    if landing_on_own_side:
        target_x = s['ball']['expectedLandingPointX'] - toward_net * 12
    else:
        target_x = standby_x

    dx = target_x - s['self']['x']
    x = 0
    if abs(dx) > 6:
        x = 1 if dx > 0 else -1

    y = 0
    x_aligned = abs(s['ball']['x'] - s['self']['x']) < PLAYER_HALF_LENGTH
    ball_slow_sideways = abs(s['ball']['xVelocity']) < 5
    ball_clearly_high = s['ball']['y'] < 150
    if (
        s['self']['state'] == 0
        and x_aligned
        and ball_slow_sideways
        and ball_clearly_high
        and s['ball']['yVelocity'] > 0
    ):
        y = -1

    return {'x': x, 'y': y, 'hit': 0}
```

## 붙여보기

- `Positioning v1` vs `AI`: 내장 AI 상대로 몇 랠리는 살아남을 겁니다. 다만
  파워히트가 없어서 결국 잘 조준된 스매시엔 밀립니다.
- `Positioning v1` vs `Minimal v1`: 완승. 뼈대만 있는 봇은 아예 못 움직이니까요.

## 다음 단계

지금은 공격 수단이 없어서 결정타를 못 냅니다. 다음 예제에서 파워히트를
추가합니다 → [Power Hit (공격형)](power-hit.md).
