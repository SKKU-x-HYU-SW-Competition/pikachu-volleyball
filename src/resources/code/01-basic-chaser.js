/**
 * 기본 추격형 봇
 *
 * 목적: 예상 착지점을 따라가는 가장 작은 decide(snapshot) 예제입니다.
 * 학습 포인트: side에 따른 코트 범위, 스냅샷 읽기, x 입력 반환을 보여줍니다.
 * 의도적 약점: 점프와 파워히트를 쓰지 않고, 공이 어느 코트에 있는지도 판단하지 않습니다.
 */

const COURT_BOUNDS = {
  // 플레이어 x는 몸의 중심 좌표입니다. 몸의 반폭 32px 때문에 화면 끝이나
  // 네트 중심(216)까지 갈 수 없어서 실제 이동 가능한 중심 범위만 사용합니다.
  LEFT: { minX: 32, maxX: 184 },
  RIGHT: { minX: 248, maxX: 400 },
};
// 목표와 8px 이내라면 계속 좌우로 흔들리지 않고 그 자리에 멈춥니다.
const DEAD_ZONE = 8;

// 예상 착지점이 자기 코트 밖이어도 플레이어가 네트나 벽을 향해 계속
// 달리지 않도록 목표 좌표를 실제 이동 범위 안으로 제한합니다.
function clamp(value, minValue, maxValue) {
  return Math.max(minValue, Math.min(value, maxValue));
}

function decide(snapshot) {
  // 같은 코드를 LEFT와 RIGHT에 모두 붙여넣을 수 있도록 현재 진영의
  // 이동 범위를 snapshot.side로 선택합니다.
  const bounds = COURT_BOUNDS[snapshot.side];
  const selfX = snapshot.self.x;

  // expectedLandingPointX는 엔진이 계산해 준 공의 예상 착지 x좌표입니다.
  // 이 봇은 공의 현재 위치가 아니라 이 좌표를 목적지로 삼습니다.
  const targetX = clamp(
    snapshot.ball.expectedLandingPointX,
    bounds.minX,
    bounds.maxX,
  );
  const difference = targetX - selfX;

  // x=-1은 왼쪽 이동, x=1은 오른쪽 이동, x=0은 정지입니다.
  // 이 기본 예제는 점프(y)와 파워히트/다이빙(hit)을 사용하지 않습니다.
  let x = 0;
  if (difference < -DEAD_ZONE) {
    x = -1;
  } else if (difference > DEAD_ZONE) {
    x = 1;
  }

  // 매 판단마다 세 필드를 모두 반환해야 합니다. 일부 필드를 생략하면
  // 잘못된 액션으로 판정되어 그 틱이 무입력 처리됩니다.
  return { x, y: 0, hit: 0 };
}
