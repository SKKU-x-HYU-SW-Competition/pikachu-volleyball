/**
 * 공격형 봇
 *
 * 목적: 예상 착지점을 수비하면서 점프와 파워히트로 공격하는 예제입니다.
 * 학습 포인트: 플레이어 state에 따라 점프와 파워히트를 구분하고,
 *   파워히트 순간의 x/y 입력으로 공격 방향과 각도를 정하는 방법을 보여줍니다.
 * 의도적 약점: 낮고 먼 공에 다이빙하지 않고, 상대 위치나 점수를 고려하지 않습니다.
 */

const COURT_BOUNDS = {
  // 플레이어 중심이 벽과 네트를 침범하지 않고 이동할 수 있는 범위입니다.
  LEFT: { minX: 32, maxX: 184 },
  RIGHT: { minX: 248, maxX: 400 },
};
// 공이 상대 코트에 있을 때 돌아갈 좌우 진영의 중앙 수비 위치입니다.
const STANDBY_X = { LEFT: 108, RIGHT: 324 };
const NET_X = 216;
// 목표와 가까울 때 좌우 입력이 계속 바뀌지 않도록 만드는 정지 구간입니다.
const DEAD_ZONE = 8;
// 봇 입력은 3프레임마다 결정되고 Worker 응답도 비동기로 적용됩니다.
// 실제 충돌 범위(32px)에 들어온 뒤 누르면 늦으므로 더 넓은 범위에서 미리 타격을 준비합니다.
const HIT_PREPARE_X_RANGE = 80;
const HIT_PREPARE_Y_RANGE = 96;

function clamp(value, minValue, maxValue) {
  // 공이나 예상 착지점이 코트 밖에 있어도 목표는 실제 이동 범위 안으로 제한합니다.
  return Math.max(minValue, Math.min(value, maxValue));
}

function moveToward(currentX, targetX) {
  // 목표와 현재 위치의 차이를 -1(왼쪽), 0(정지), 1(오른쪽) 액션으로 바꿉니다.
  const difference = targetX - currentX;
  if (difference < -DEAD_ZONE) {
    return -1;
  }
  if (difference > DEAD_ZONE) {
    return 1;
  }
  return 0;
}

function isExpectedLandingOnOwnCourt(side, expectedLandingPointX) {
  // 네트 x=216을 기준으로 예상 착지점이 자기 코트인지 판정합니다.
  return side === 'LEFT'
    ? expectedLandingPointX < NET_X
    : expectedLandingPointX > NET_X;
}

function decide(snapshot) {
  // 읽기 편하도록 이번 판단에서 자주 쓰는 스냅샷 영역을 짧은 변수로 꺼냅니다.
  const side = snapshot.side;
  const self = snapshot.self;
  const ball = snapshot.ball;
  const bounds = COURT_BOUNDS[side];

  let targetX;
  if (self.state === 1 || self.state === 2) {
    // 점프 또는 파워히트 동작 중에는 착지점이 아니라 현재 공의 x를 쫓습니다.
    // 공중에서는 남은 시간이 짧아서 실제 공과 가로 위치를 맞추는 것이 더 중요합니다.
    targetX = clamp(ball.x, bounds.minX, bounds.maxX);
  } else if (
    isExpectedLandingOnOwnCourt(side, ball.expectedLandingPointX)
  ) {
    // 공이 자기 코트에 떨어질 예정이면 예상 착지점으로 미리 이동합니다.
    targetX = clamp(
      ball.expectedLandingPointX,
      bounds.minX,
      bounds.maxX,
    );
  } else {
    // 공이 상대 코트에 있다면 네트에 붙지 않고 중앙 수비 위치로 복귀합니다.
    targetX = STANDBY_X[side];
  }

  // 기본 액션은 목표로 이동하면서 점프와 파워히트를 누르지 않는 상태입니다.
  let x = moveToward(self.x, targetX);
  let y = 0;
  let hit = 0;

  if (
    // state=0은 땅에 서 있는 상태라서 새 점프를 시작할 수 있습니다.
    self.state === 0 &&
    // 공이 너무 멀면 점프해도 닿지 않으므로 가로 거리 60px 안에서만 시도합니다.
    Math.abs(ball.x - self.x) < 60 &&
    // 화면 좌표는 아래쪽이 양수입니다. 플레이어보다 20px 이상 위에 있는 공만 봅니다.
    ball.y < self.y - 20 &&
    // 내려오는 공에 맞춰 점프하도록 세로 속도가 양수일 때만 반응합니다.
    ball.yVelocity > 0
  ) {
    // 지상에서 y=-1은 점프 액션입니다.
    y = -1;
  }

  // 현재 공이 조기 타격 준비 범위 안에 들어왔는지 확인합니다.
  // 실제 충돌 범위는 32px이지만 그때 판단하면 비동기 입력이 늦게 도착할 수 있습니다.
  const preparingToHit =
    Math.abs(ball.x - self.x) < HIT_PREPARE_X_RANGE &&
    Math.abs(ball.y - self.y) < HIT_PREPARE_Y_RANGE;

  if ((self.state === 1 || self.state === 2) && preparingToHit) {
    // state=1에서는 파워히트를 미리 시작하고, state=2 동안에도 같은 방향을
    // 유지해 실제 공 충돌 순간에 원하는 스매시 각도가 적용되게 합니다.
    // 파워히트 순간 x의 부호가 타구 방향을 직접 정하지는 않지만,
    // x가 0이 아니면 공의 수평 속도가 커집니다. 이동 목적도 겸해 네트 방향을 선택합니다.
    x = side === 'LEFT' ? 1 : -1;
    // 네트에 가까우면 y=1 급강하 스매시, 멀면 y=-1 높은 안전 타구를 사용합니다.
    // 먼 곳에서 급강하하면 공이 네트를 넘기 전에 자기 코트에 떨어질 수 있기 때문입니다.
    y = Math.abs(self.x - NET_X) < 80 ? 1 : -1;
    // 점프 중 hit=1은 파워히트를 시작합니다. state=2에서는 재발동되지 않지만
    // 값을 유지해 타격 모션이 끝날 때까지 같은 명령을 보존합니다.
    hit = 1;
  }

  // x는 이동, y는 점프 또는 스매시 각도, hit은 파워히트 입력입니다.
  return { x, y, hit };
}
