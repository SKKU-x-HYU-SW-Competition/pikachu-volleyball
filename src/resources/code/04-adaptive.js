/**
 * 적응형 봇
 *
 * 위치 선정, 점프, 파워히트, 긴급 다이빙, 상대 위치에 따른 타구 선택과
 * 틱 사이에 유지되는 간단한 기억을 조합한 예제입니다.
 *
 * 학습 포인트:
 * - 하나의 스냅샷을 WAIT/RECEIVE/ATTACK/EMERGENCY/RECOVER 행동 모드로 구분합니다.
 * - self.state를 확인해 서로 충돌하는 행동을 동시에 내리지 않습니다.
 * - 엔진 내부에 의존하지 않고 decide() 바깥의 간단한 상태를 틱 사이에 유지합니다.
 *
 * 의도적 약점:
 * 완전한 궤적 시뮬레이션 대신 직접 정한 임계값을 사용하므로,
 * 벽에 빠르게 튕긴 공의 움직임에는 잘못 반응할 수 있습니다.
 */
'use strict';

var NET_X = 216;
// 플레이어 중심이 벽과 네트를 침범하지 않고 이동할 수 있는 범위입니다.
var LEFT_MIN_X = 32;
var LEFT_MAX_X = 184;
var RIGHT_MIN_X = 248;
var RIGHT_MAX_X = 400;
// 공이 상대 코트에 있을 때 돌아갈 좌우 진영의 중앙 수비 위치입니다.
var LEFT_STANDBY_X = 108;
var RIGHT_STANDBY_X = 324;
// 목표 근처에서 좌우로 떨지 않도록 이 거리 안에서는 정지합니다.
var POSITION_DEAD_ZONE = 8;
// 일반 몸통 충돌도 상대 코트 쪽으로 튀기기 쉽도록 착지점보다
// 네트 반대 방향에 자리 잡는 보정값입니다.
var LANDING_OFFSET = 12;
// 봇 입력은 3프레임마다 결정되고 Worker 응답도 비동기로 적용됩니다.
// 기존 48px 조건은 입력이 도착하기 전에 공이 충돌 범위를 지나치는 문제가 있어,
// 실제 충돌보다 넓은 범위에서 파워히트를 미리 준비합니다.
var HIT_PREPARE_X_RANGE = 80;
var HIT_PREPARE_Y_RANGE = 96;
// true로 바꾸면 점수와 행동 모드가 바뀔 때 Worker 콘솔에 로그를 남깁니다.
var DEBUG = false;

// decide() 바깥의 변수는 틱 사이에 유지됩니다. 이 값들은 점수 변화를
// 감지하고 행동 모드가 바뀔 때만 로그를 출력하는 상태 기억 예제입니다.
var previousSelfScore = null;
var previousOppScore = null;
var lastMode = 'WAIT';
var decisionCount = 0;

// 숫자를 최솟값과 최댓값 사이로 제한하는 공통 함수입니다.
function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

// 공이나 착지점 좌표가 자기 코트 밖이어도 이동 목표는 실제 코트 안에 둡니다.
function clampToOwnCourt(side, x) {
  return side === 'RIGHT'
    ? clamp(x, RIGHT_MIN_X, RIGHT_MAX_X)
    : clamp(x, LEFT_MIN_X, LEFT_MAX_X);
}

// 주어진 x좌표가 현재 봇 진영에 속하는지 네트 위치를 기준으로 판단합니다.
function isOnOwnSide(side, x) {
  return side === 'RIGHT' ? x > NET_X && x < 432 : x > 0 && x < NET_X;
}

// 목표 좌표를 엔진 입력 -1(왼쪽), 0(정지), 1(오른쪽)로 변환합니다.
function moveToward(currentX, targetX) {
  var difference = targetX - currentX;
  if (Math.abs(difference) <= POSITION_DEAD_ZONE) {
    return 0;
  }
  return difference > 0 ? 1 : -1;
}

function standbyX(side, opponentNearNet) {
  var base = side === 'RIGHT' ? RIGHT_STANDBY_X : LEFT_STANDBY_X;
  var awayFromNet = side === 'RIGHT' ? 1 : -1;
  // 상대가 네트 가까이에 있으면 급강하 공격에 대비해 평소보다 16px 뒤에서 기다립니다.
  return base + (opponentNearNet ? awayFromNet * 16 : 0);
}

// 액션을 반환하기 전에 현재 행동 모드를 기억하고, 디버그가 켜졌다면
// 모드가 바뀐 순간만 출력해 콘솔이 매 틱 로그로 도배되는 것을 막습니다.
function finishDecision(snapshot, mode, action) {
  if (DEBUG && mode !== lastMode) {
    console.log(
      '[adaptive ' +
        snapshot.side +
        '] decision=' +
        decisionCount +
        ' tick=' +
        snapshot.tick +
        ' ' +
        lastMode +
        ' -> ' +
        mode,
      action
    );
  }
  lastMode = mode;
  return action;
}

function decide(s) {
  // 호출 횟수는 엔진 프레임 수와 다릅니다. 현재 설정에서는 약 3프레임마다 증가합니다.
  decisionCount += 1;

  // 이전 점수와 비교해 득점이 발생한 순간을 감지합니다. 전략 판단에는 현재
  // 점수 차이를 사용하고, 이전 점수는 상태 기억과 디버깅 예제로만 사용합니다.
  var selfScore = s.meta.score.self;
  var oppScore = s.meta.score.opp;
  var scoreChanged =
    previousSelfScore !== null &&
    (selfScore !== previousSelfScore || oppScore !== previousOppScore);
  if (DEBUG && scoreChanged) {
    console.log(
      '[adaptive ' +
        s.side +
        '] score=' +
        selfScore +
        ':' +
        oppScore
    );
  }
  previousSelfScore = selfScore;
  previousOppScore = oppScore;

  // 점수 차이는 앞서면 양수, 뒤지면 음수입니다. 아래에서 안전/공격 기준을 조절합니다.
  var scoreDifference = selfScore - oppScore;
  // LEFT에서는 오른쪽(+1), RIGHT에서는 왼쪽(-1)이 네트 방향입니다.
  var towardNet = s.side === 'RIGHT' ? -1 : 1;
  var awayFromNet = -towardNet;
  var ballLandingOnOwnSide = isOnOwnSide(
    s.side,
    s.ball.expectedLandingPointX
  );
  var opponentNearNet = Math.abs(s.opp.x - NET_X) < 80;

  // RECOVER: state=3은 다이빙 중, state=4는 다이빙 후 누운 상태입니다.
  // 이때는 엔진이 정해진 동작을 수행하므로 새 액션을 내지 않고 회복을 기다립니다.
  if (s.self.state === 3 || s.self.state === 4) {
    return finishDecision(s, 'RECOVER', { x: 0, y: 0, hit: 0 });
  }

  var distanceToBall = Math.abs(s.ball.x - s.self.x);
  var emergencyDistance = 80;
  if (scoreDifference >= 3) {
    // 크게 앞설 때는 무리한 다이빙을 줄이고 정말 먼 공에만 시도합니다.
    emergencyDistance = 96;
  } else if (scoreDifference <= -3) {
    // 크게 뒤질 때는 더 가까운 공에도 적극적으로 다이빙합니다.
    emergencyDistance = 64;
  }
  // EMERGENCY: 땅에 있고, 낮게 내려오는 공이 자기 코트에 있으며,
  // 일반 이동으로 따라가기 어려울 만큼 멀 때만 다이빙합니다.
  var shouldDive =
    s.self.state === 0 &&
    ballLandingOnOwnSide &&
    isOnOwnSide(s.side, s.ball.x) &&
    s.ball.y > 174 &&
    s.ball.yVelocity > 0 &&
    distanceToBall > emergencyDistance;

  if (shouldDive) {
    // 지상에서 x를 공 방향으로 주고 hit=1을 함께 반환하면 다이빙이 시작됩니다.
    return finishDecision(s, 'EMERGENCY', {
      x: s.ball.x > s.self.x ? 1 : -1,
      y: 0,
      hit: 1,
    });
  }

  // ATTACK: state=1(점프) 또는 state=2(파워히트 동작)에서는 예상 착지점보다
  // 실제 공 위치를 따라가며, 충돌 전에 파워히트를 준비합니다.
  if (s.self.state === 1 || s.self.state === 2) {
    var airX = moveToward(
      s.self.x,
      clampToOwnCourt(s.side, s.ball.x)
    );
    var preparingToHit =
      Math.abs(s.ball.x - s.self.x) < HIT_PREPARE_X_RANGE &&
      Math.abs(s.ball.y - s.self.y) < HIT_PREPARE_Y_RANGE;

    if (preparingToHit) {
      var distanceToNet = Math.abs(s.self.x - NET_X);
      // y=0은 직선에 가까운 타구를 뜻하며 아래 조건에 따라 안전 타구나
      // 급강하 타구로 바꿉니다.
      var shotY = 0;
      if (
        scoreDifference >= 3 ||
        distanceToNet >= 80 ||
        opponentNearNet
      ) {
        // 앞서고 있거나 네트에서 멀거나 상대가 네트 앞을 막으면
        // y=-1의 높은 궤도로 안전하게 넘깁니다.
        shotY = -1;
      } else if (scoreDifference <= -3 || Math.abs(s.opp.x - NET_X) >= 112) {
        // 뒤지고 있거나 상대가 코트 뒤쪽에 있으면 y=1 급강하를 노립니다.
        shotY = 1;
      }
      // state=1에서는 파워히트를 미리 시작하고, state=2인 타격 모션 중에도
      // 같은 x/y를 유지해 실제 공 충돌 순간에 선택한 각도가 적용되게 합니다.
      return finishDecision(s, 'ATTACK', {
        // 0이 아닌 x는 파워히트의 수평 속도를 높이며, 이동 방향도 네트 쪽으로 맞춥니다.
        x: towardNet,
        y: shotY,
        hit: 1,
      });
    }

    // 아직 타격 준비 범위 밖이라면 공의 현재 x를 따라가되 hit은 누르지 않습니다.
    return finishDecision(s, 'ATTACK', { x: airX, y: 0, hit: 0 });
  }

  // RECEIVE: 공이 자기 코트에 떨어질 예정이면 착지점보다 네트 반대쪽에
  // 자리를 잡고, 닿을 수 있는 높은 하강 공에 점프합니다.
  if (ballLandingOnOwnSide) {
    var receiveTarget = clampToOwnCourt(
      s.side,
      s.ball.expectedLandingPointX + awayFromNet * LANDING_OFFSET
    );
    var receiveX = moveToward(s.self.x, receiveTarget);
    // 크게 뒤질 때는 공격 기회를 늘리기 위해 점프 허용 거리를 조금 넓힙니다.
    var jumpRange = scoreDifference <= -3 ? 68 : 60;
    var shouldJump =
      s.self.state === 0 &&
      distanceToBall < jumpRange &&
      s.ball.y < s.self.y - 20 &&
      s.ball.yVelocity > 0;
    return finishDecision(s, 'RECEIVE', {
      x: receiveX,
      // 지상에서 y=-1은 점프 액션이며 hit=0이라 다이빙은 발생하지 않습니다.
      y: shouldJump ? -1 : 0,
      hit: 0,
    });
  }

  // WAIT: 공이 상대 코트에 있으면 중앙 대기 위치로 돌아갑니다.
  // 상대가 네트에 가까우면 standbyX()가 목표를 코트 뒤쪽으로 보정합니다.
  var waitTarget = clampToOwnCourt(
    s.side,
    standbyX(s.side, opponentNearNet)
  );
  return finishDecision(s, 'WAIT', {
    x: moveToward(s.self.x, waitTarget),
    y: 0,
    hit: 0,
  });
}
