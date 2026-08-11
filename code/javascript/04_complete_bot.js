/**
 * Example Bot 04 - Complete Bot
 *
 * 앞의 예제에서 사용한 이동, 착지 예측, 점프, hit을
 * 하나의 Bot에 합친 간단한 완성형 예제입니다.
 *
 * 주요 내용:
 * - expectedLandingPointX를 이용한 수비 위치 선정
 * - 낮고 먼 공에 대한 간단한 dive
 * - jump와 hit을 동시에 입력하여 power-hit을 미리 준비
 * - 공중에서는 hit을 유지하여 판단 주기 사이의 hit 누락을 줄임
 * - 상대 위치에 따라 UP / DOWN 공격을 간단히 선택
 *
 * 성능을 극대화하기 위한 Bot이 아니라,
 * 참가자가 기본 구조를 참고하고 수정하기 위한 예제입니다.
 */

const NET_X = 216;
const PLAYER_HALF = 32;
const GROUND_WIDTH = 432;

function isLeftSide(snapshot) {
  return snapshot.side === 'LEFT';
}

function isOnMySide(snapshot, x) {
  return isLeftSide(snapshot) ? x < NET_X : x > NET_X;
}

function clampToMyCourt(snapshot, x) {
  if (isLeftSide(snapshot)) {
    return Math.max(
      PLAYER_HALF,
      Math.min(NET_X - PLAYER_HALF, x)
    );
  }

  return Math.max(
    NET_X + PLAYER_HALF,
    Math.min(GROUND_WIDTH - PLAYER_HALF, x)
  );
}

function moveToward(currentX, targetX, deadZone = 8) {
  if (targetX < currentX - deadZone) {
    return -1;
  }

  if (targetX > currentX + deadZone) {
    return 1;
  }

  return 0;
}

function decide(snapshot) {
  const self = snapshot.self;
  const opp = snapshot.opp;
  const ball = snapshot.ball;

  const ballOnMySide = isOnMySide(snapshot, ball.x);

  const landingOnMySide = isOnMySide(
    snapshot,
    ball.expectedLandingPointX
  );

  const distanceX = Math.abs(ball.x - self.x);
  const distanceY = Math.abs(ball.y - self.y);

  /*
   * 기본 수비 위치를 정합니다.
   *
   * 공 또는 예상 착지점이 내 진영에 있으면
   * expectedLandingPointX를 따라가고,
   * 그렇지 않으면 진영 중앙 부근에서 대기합니다.
   */
  const standbyX = isLeftSide(snapshot) ? 112 : 320;

  let targetX = standbyX;

  if (ballOnMySide || landingOnMySide) {
    targetX = clampToMyCourt(
      snapshot,
      ball.expectedLandingPointX
    );
  }

  let x = moveToward(self.x, targetX);
  let y = 0;
  let hit = 0;

  /*
   * 1. 이미 공중에 있다면 공 쪽으로 움직이면서 hit을 유지합니다.
   *
   * Bot은 매 물리 프레임마다 새 결정을 내리는 것이 아니므로,
   * 공과 매우 가까워진 한 순간에만 hit=1을 보내면 타이밍을
   * 놓칠 수 있습니다. 따라서 공격 범위 안에서는 hit을 유지합니다.
   */
  if (self.state === 1 || self.state === 2) {
    x = moveToward(self.x, ball.x, 6);

    const attackZone =
      ballOnMySide ||
      Math.abs(ball.x - NET_X) < 35;

    if (
      attackZone &&
      distanceX < 82 &&
      distanceY < 105
    ) {
      hit = 1;

      /*
       * 상대가 네트에 가까우면 위로 보내 block을 피하고,
       * 그렇지 않으면 아래로 내려꽂는 단순 공격을 사용합니다.
       */
      if (Math.abs(opp.x - NET_X) < 72) {
        y = -1;
      } else {
        y = 1;
      }
    }

    return {
      x: x,
      y: y,
      hit: hit
    };
  }

  /*
   * 2. 낮게 떨어지는 공이 멀리 있으면 간단한 dive를 사용합니다.
   *
   * 지상에서 x 방향과 hit=1을 함께 입력하면 dive가 됩니다.
   */
  if (
    self.state === 0 &&
    ballOnMySide &&
    ball.yVelocity > 0 &&
    ball.y > 195 &&
    distanceX > 68 &&
    distanceX < 125
  ) {
    x = ball.x < self.x ? -1 : 1;

    return {
      x: x,
      y: 0,
      hit: 1
    };
  }

  /*
   * 3. 공격 가능한 높이의 공이 가까우면
   * jump + hit을 동시에 입력합니다.
   *
   * jump를 먼저 하고 다음 decide()에서 hit을 기다리는 대신,
   * 같은 입력에서 y=-1과 hit=1을 함께 보내 power-hit 상태를
   * 미리 준비합니다.
   *
   * 이렇게 하면 판단 주기 사이에 공이 먼저 몸에 닿아
   * 일반 바운스가 되는 경우를 줄일 수 있습니다.
   */
  const attackZone =
    ballOnMySide ||
    Math.abs(ball.x - NET_X) < 30;

  if (
    self.state === 0 &&
    attackZone &&
    distanceX < 62 &&
    ball.y > 100 &&
    ball.y < 190
  ) {
    x = moveToward(self.x, ball.x, 5);

    y = -1;
    hit = 1;
  }

  return {
    x: x,
    y: y,
    hit: hit
  };
}
