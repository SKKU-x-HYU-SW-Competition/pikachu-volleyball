/**
 * Example Bot 03 - Landing Prediction
 *
 * 현재 공의 위치만 따라가는 대신,
 * expectedLandingPointX를 이용하여 예상 착지 위치로
 * 미리 이동하는 예제입니다.
 *
 * 주요 내용:
 * - expectedLandingPointX 사용
 * - yVelocity를 통한 공의 이동 방향 확인
 * - 간단한 예측 기반 이동
 *
 * 이 코드는 예제이므로 상대의 재공격이나
 * 복잡한 공의 궤적까지 예측하지 않습니다.
 */
function decide(snapshot) {
  const self = snapshot.self;
  const ball = snapshot.ball;

  let x = 0;
  let y = 0;
  let hit = 0;

  /*
   * 현재 공 위치가 아닌 예상 착지 x 좌표를
   * 이동 목표로 사용합니다.
   */
  const targetX = ball.expectedLandingPointX;

  if (targetX < self.x - 10) {
    x = -1;
  } else if (targetX > self.x + 10) {
    x = 1;
  }

  const distanceX = Math.abs(ball.x - self.x);
  const distanceY = Math.abs(ball.y - self.y);

  /*
   * yVelocity > 0이면 공이 아래쪽으로 이동 중입니다.
   *
   * 내려오는 공이 가까워지면 점프합니다.
   */
  if (
    self.state === 0 &&
    ball.yVelocity > 0 &&
    distanceX < 55 &&
    ball.y > 120
  ) {
    y = -1;
  }

  // 점프 중 공과 가까워지면 hit을 시도합니다.
  if (
    self.state === 1 &&
    distanceX < 38 &&
    distanceY < 38
  ) {
    hit = 1;
  }

  return {
    x: x,
    y: y,
    hit: hit
  };
}
