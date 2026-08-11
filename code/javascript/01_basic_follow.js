/**
 * Example Bot 01 - Basic Follow
 *
 * 가장 기본적인 Bot 예제입니다.
 * 공의 x 좌표를 확인하고 공이 있는 방향으로 이동합니다.
 *
 * 주요 내용:
 * - decide(snapshot) 함수
 * - snapshot.self / snapshot.ball 사용
 * - 좌우 이동 입력
 */
function decide(snapshot) {
  const self = snapshot.self;
  const ball = snapshot.ball;

  let x = 0;

  // 공이 플레이어보다 왼쪽에 있으면 왼쪽으로 이동합니다.
  if (ball.x < self.x - 10) {
    x = -1;
  }

  // 공이 플레이어보다 오른쪽에 있으면 오른쪽으로 이동합니다.
  else if (ball.x > self.x + 10) {
    x = 1;
  }

  /*
   * 반환값
   *
   * x   : -1(왼쪽), 0(정지), 1(오른쪽)
   * y   : -1(위),   0(없음), 1(아래)
   * hit : 0(없음), 1(hit 입력)
   */
  return {
    x: x,
    y: 0,
    hit: 0
  };
}
