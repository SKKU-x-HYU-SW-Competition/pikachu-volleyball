# 예제 3: Power Hit — 파워히트로 공격

**목표**: [Positioning 예제](no-hit-positioning.md)에 파워히트를 얹습니다.
공을 향해 점프하고, 위치에 따라 스매시 각도를 바꿔서 넘깁니다. 그 과정에서
**`hit`과 `y`의 상호작용**, 그리고 **`x` 방향이 스매시의 좌우 방향을 결정하지
않는다**는 자주 오해하는 규칙을 다룹니다.

## 왜 이렇게 짜는가

### 1. 공중에서 파워히트 = 스매시, 그때의 `y`로 각도가 결정된다

- `state === 1` (점프 중)일 때 `hit = 1`을 보내면 파워히트(스매시) 발동
- 발동되는 그 순간의 `y` 값이 각도를 결정:
  - `y = -1` → 아치를 그리며 넘기는 스매시 (거리 벌 때 유리)
  - `y =  0` → 직선 스매시
  - `y =  1` → 아래로 꽂히는 강스매시 (짧게 떨어짐)

### 2. `y = 1`은 항상 좋은 선택이 아니다

강스매시(`y = 1`)는 짧게 떨어지므로, **내가 네트에서 멀면 그대로 내 코트에
꽂힙니다.** 자기 코트에 자기가 스매시한 셈이라 실점.

→ 네트에서 가까울 때만 `y = 1`, 멀리 있으면 `y = -1`로 아치를 그려서 넘깁니다.

### 3. `x`의 부호는 공이 넘어가는 방향을 결정하지 않는다

파워히트 순간의 `x` 부호로 "공을 왼쪽으로 넘길지 오른쪽으로 넘길지"를 정할 수
있을 것 같지만 **그렇지 않습니다**. 엔진은 **공이 네트의 어느 쪽에 있는지**를
보고 자동으로 반대편 코트로 향하게 튕깁니다. 봇의 `x` 부호는:

- **`x ≠ 0`이면 파워히트 속도가 두 배**가 됩니다 (0이면 그냥 파워히트 속도)
- 그 부호가 왼쪽이든 오른쪽이든 결과 방향엔 영향 없음

그래서 파워히트 순간에도 그냥 `x = towardNet` (네트 쪽으로 이동)을 넣어서
속도 부스트도 챙기고, 다음 액션을 위해 위치도 좋게 하는 게 관용적입니다.

## JavaScript

`src/code-here/PowerHit_v1.js`:

```js
'use strict';

function decide(s) {
  var NET_X = 216;
  var towardNet = s.side === 'RIGHT' ? -1 : 1;

  // 1. 예상 낙하지점으로 이동
  var dx = s.ball.expectedLandingPointX - s.self.x;
  var x = 0;
  if (Math.abs(dx) > 8) {
    x = dx > 0 ? 1 : -1;
  }

  var y = 0;
  var hit = 0;
  var closeEnough = Math.abs(s.ball.x - s.self.x) < 60;
  var ballAbove   = s.ball.y < s.self.y - 20;

  // 2. 땅에 있고 공이 위에서 내려오는 중이면 점프
  if (s.self.state === 0 && closeEnough && ballAbove && s.ball.yVelocity > 0) {
    y = -1;   // 점프
  }

  // 3. 점프 중이고 공이 옆에 있으면 스매시
  if (s.self.state === 1 && closeEnough) {
    hit = 1;
    var distanceToNet = Math.abs(s.self.x - NET_X);
    if (distanceToNet < 80) {
      y = 1;    // 네트 가까움 => 강스매시 안전
    } else {
      y = -1;   // 아직 멀다 => 아치로 넘김
    }
    // x 부호는 공 방향과 무관 -- 그냥 네트쪽으로 (속도 부스트 겸)
    x = towardNet;
  }

  return { x: x, y: y, hit: hit };
}
```

## Python

`src/code-here/PowerHit_v1.py`:

```python
def decide(s):
    NET_X = 216
    toward_net = -1 if s['side'] == 'RIGHT' else 1

    dx = s['ball']['expectedLandingPointX'] - s['self']['x']
    x = 0
    if abs(dx) > 8:
        x = 1 if dx > 0 else -1

    y = 0
    hit = 0
    close_enough = abs(s['ball']['x'] - s['self']['x']) < 60
    ball_above   = s['ball']['y'] < s['self']['y'] - 20

    if s['self']['state'] == 0 and close_enough and ball_above and s['ball']['yVelocity'] > 0:
        y = -1

    if s['self']['state'] == 1 and close_enough:
        hit = 1
        distance_to_net = abs(s['self']['x'] - NET_X)
        if distance_to_net < 80:
            y = 1
        else:
            y = -1
        x = toward_net

    return {'x': x, 'y': y, 'hit': hit}
```

## 흐름을 상태로 정리하면

한 랠리 안에서 `state`가 바뀌면서 이 봇이 어떤 결정을 내리는지:

```
state 0 (땅에 있음)
  ├─ 공이 옆에 없음        → 낙하지점 향해 이동
  ├─ 공이 옆에 있고 위      → y=-1 (점프!)
  └─ 공이 옆에 있고 아래    → 이동만 (이미 늦음)

state 1 (점프 중)
  ├─ 공이 옆에 없음        → x만 조절 (허공 점프)
  └─ 공이 옆에 있음        → hit=1 + y로 각도 선택 + x=towardNet
                            (스매시!)

state 2 (파워히트 발동 중)
  → 무슨 입력 보내도 스매시 애니메이션 끝날 때까지 무시됨

state 0 (착지 후)
  → 다시 반복
```

## 붙여보기

- `PowerHit v1` vs `AI`: 내장 AI와 어느 정도 비슷하게 겨룹니다.
- `PowerHit v1` vs `Positioning v1`: 파워히트가 있는 쪽이 공격 기회를 많이 가져갑니다.
- `PowerHit v1` vs `PowerHit v1` (같은 파일을 양쪽에): 대칭이라 특정 스코어에서
  랠리가 길어지는 경우가 자주 보입니다.

## 여기서부터는 여러분의 몫

이 예제는 **베이스라인**입니다. 실제 대회에서 이기려면 이 위에 추가 로직이
필요합니다. 몇 가지 생각해볼 만한 방향:

- **다이빙**: `state === 0`에서 `x ≠ 0`이면서 `hit = 1`을 보내면 다이빙. 낙하지점이
  너무 멀어 걷기로는 못 갈 때 시도해볼 수 있습니다.
- **적응형 각도**: 상대의 위치(`opp.x`)를 보고 상대에게서 먼 쪽으로 각도 선택.
- **서브 특화**: `meta.rallyFrameCount`가 작을 때(랠리 극초반 = 서브 순간)엔
  다른 로직 사용.
- **직전 스냅샷 기억**: 파일 최상위에 `var lastBallX = 0;` 같은 변수를 두고
  매 틱 갱신해서 공의 가속도까지 활용.
- **상대 패턴 학습**: 상대가 자주 넘기는 위치를 카운트해서 미리 그쪽으로 대기.

여기까지 오면 API 페이지의 필드들이 다 눈에 들어올 겁니다. 다시 훑어보고
싶다면 → [decide 함수와 스냅샷](../api.md)
