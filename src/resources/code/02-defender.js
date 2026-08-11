/**
 * 수비형 봇
 *
 * 목적:
 *   공이 상대 코트에 떨어질 것으로 예상되면 안정적인 대기 위치로 돌아가고,
 *   자기 코트에 떨어질 것으로 예상되면 착지 지점을 지킵니다.
 *
 * 학습 포인트:
 *   - snapshot.side를 사용하면 하나의 코드로 LEFT와 RIGHT 양쪽에서 동작할 수 있습니다.
 *   - ball.expectedLandingPointX로 공이 떨어지기 전에 수비 위치를 정할 수 있습니다.
 *   - self.state와 공의 속도를 함께 보면 불필요한 점프를 줄일 수 있습니다.
 *
 * 의도적 약점:
 *   파워히트와 다이빙을 전혀 사용하지 않고 상대 위치도 고려하지 않습니다.
 *   바로 닿을 수 없는 낮고 빠른 공을 자주 놓칩니다.
 */

const NET_X = 216;
// 플레이어 중심이 실제로 이동할 수 있는 좌우 진영별 x 범위입니다.
const LEFT_MIN_X = 32;
const LEFT_MAX_X = 184;
const RIGHT_MIN_X = 248;
const RIGHT_MAX_X = 400;
// 공이 상대 코트에 있을 때 네트 앞에 붙지 않고 기다릴 기본 수비 위치입니다.
const LEFT_STANDBY_X = 108;
const RIGHT_STANDBY_X = 324;
// 착지점보다 네트 반대쪽에 서서 일반 몸통 충돌도 상대 코트 방향으로
// 튀기기 쉽게 만드는 위치 보정값입니다.
const LANDING_OFFSET = 12;
// 목표 근처에서 좌우 입력이 계속 바뀌는 현상을 막는 정지 구간입니다.
const MOVE_DEAD_ZONE = 6;
// 아래 세 값은 헛점프를 줄이기 위한 조건입니다. 기본 AI의 판단을 참고해
// 가로로 잘 맞고, 옆으로 너무 빠르지 않으며, 충분히 높은 공만 점프합니다.
const JUMP_HORIZONTAL_RANGE = 32;
const JUMP_MAX_HORIZONTAL_SPEED = 5;
const JUMP_MAX_BALL_Y = 150;

// 예상 착지점이 현재 봇이 지키는 코트에 포함되는지 확인합니다.
// 이 판단 덕분에 공이 상대 코트에 있을 때 불필요하게 네트까지 쫓아가지 않습니다.
function isExpectedLandingOnOwnSide(side, expectedLandingPointX) {
  if (side === 'LEFT') {
    return expectedLandingPointX >= 0 && expectedLandingPointX <= NET_X;
  }
  return expectedLandingPointX >= NET_X && expectedLandingPointX <= 432;
}

// 목표 좌표가 플레이어의 실제 이동 범위를 벗어나지 않도록 제한합니다.
function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(value, maximum));
}

function getTargetX(snapshot) {
  const side = snapshot.side;
  const landingX = snapshot.ball.expectedLandingPointX;

  if (!isExpectedLandingOnOwnSide(side, landingX)) {
    // 공이 상대 코트에 떨어질 예정이면 자기 코트 중앙으로 복귀합니다.
    return side === 'LEFT' ? LEFT_STANDBY_X : RIGHT_STANDBY_X;
  }

  // 공이 자기 코트에 떨어질 예정이면 착지점 바로 아래가 아니라 네트의
  // 반대쪽으로 12px 물러난 위치를 목표로 삼습니다.
  if (side === 'LEFT') {
    return clamp(landingX - LANDING_OFFSET, LEFT_MIN_X, LEFT_MAX_X);
  }
  return clamp(landingX + LANDING_OFFSET, RIGHT_MIN_X, RIGHT_MAX_X);
}

// 목표까지의 차이가 정지 구간보다 클 때만 한 방향의 이동 액션을 냅니다.
function moveToward(currentX, targetX) {
  if (targetX < currentX - MOVE_DEAD_ZONE) {
    return -1;
  }
  if (targetX > currentX + MOVE_DEAD_ZONE) {
    return 1;
  }
  return 0;
}

function shouldJump(snapshot) {
  const player = snapshot.self;
  const ball = snapshot.ball;

  return (
    // state=0은 땅에 서 있는 정상 상태입니다. 공중이나 다이빙 중에는
    // 새 점프 입력을 보내지 않습니다.
    player.state === 0 &&
    // 플레이어 몸의 반폭과 같은 32px 안에 공이 있을 때만 점프합니다.
    Math.abs(ball.x - player.x) < JUMP_HORIZONTAL_RANGE &&
    // 옆으로 너무 빠른 공은 점프하는 동안 위치가 크게 달라지므로 포기합니다.
    Math.abs(ball.xVelocity) < JUMP_MAX_HORIZONTAL_SPEED &&
    // y좌표는 아래로 갈수록 커집니다. 150보다 작은 공은 충분히 높은 공입니다.
    ball.y < JUMP_MAX_BALL_Y &&
    // yVelocity가 양수이면 공이 아래로 내려오는 중입니다.
    ball.yVelocity > 0
  );
}

function decide(snapshot) {
  // 1단계: 공의 예상 착지 위치에 따라 대기 또는 수비 목표를 정합니다.
  const targetX = getTargetX(snapshot);
  // 2단계: 목표를 향한 좌우 이동 액션을 만듭니다.
  const x = moveToward(snapshot.self.x, targetX);
  // 3단계: 모든 안전 조건을 만족할 때만 y=-1로 점프합니다.
  const y = shouldJump(snapshot) ? -1 : 0;

  // 이 수비형은 의도적으로 hit=0만 반환합니다. 따라서 파워히트와
  // 다이빙 없이 이동과 일반 점프만으로 공을 받아냅니다.
  return { x: x, y: y, hit: 0 };
}
