/**
 * Example Bot 02 - Jump and Hit
 *
 * 공을 따라 이동하면서,
 * 공이 가까이 오면 점프하고 공중에서 hit을 시도합니다.
 *
 * 주요 내용:
 * - self.state 확인
 * - 공과 플레이어 사이 거리 계산
 * - 점프 입력
 * - 공중 hit 입력
 */
function decide(snapshot) {
  const self = snapshot.self;
  const ball = snapshot.ball;

  let x = 0;
  let y = 0;
  let hit = 0;

  // 먼저 공의 x 좌표를 따라 이동합니다.
  if (ball.x < self.x - 10) {
    x = -1;
  } else if (ball.x > self.x + 10) {
    x = 1;
  }

  // 공과 플레이어 사이의 거리를 계산합니다.
  const distanceX = Math.abs(ball.x - self.x);
  const distanceY = Math.abs(ball.y - self.y);

  /*
   * state === 0은 지상 상태입니다.
   *
   * 공이 가까이 있고 충분히 내려왔다면
   * y = -1을 입력하여 점프합니다.
   */
  if (
    self.state === 0 &&
    distanceX < 55 &&
    ball.y > 120
  ) {
    y = -1;
  }

  /*
   * state === 1은 일반적인 점프 상태입니다.
   *
   * 공중에서 공과 가까워졌다면
   * hit 입력을 시도합니다.
   */
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
