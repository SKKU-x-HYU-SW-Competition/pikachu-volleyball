"""
Example Bot 03 - Landing Prediction

현재 공의 위치만 따라가는 대신,
expectedLandingPointX를 이용하여 예상 착지 위치로
미리 이동하는 예제입니다.

주요 내용:
- expectedLandingPointX 사용
- yVelocity를 통한 공의 이동 방향 확인
- 간단한 예측 기반 이동

이 코드는 예제이므로 상대의 재공격이나
복잡한 공의 궤적까지 예측하지 않습니다.
"""


def decide(snapshot):
    self_player = snapshot['self']
    ball = snapshot['ball']

    x = 0
    y = 0
    hit = 0

    # 현재 공 위치가 아닌 예상 착지 x 좌표를
    # 이동 목표로 사용합니다.
    target_x = ball['expectedLandingPointX']

    if target_x < self_player['x'] - 10:
        x = -1
    elif target_x > self_player['x'] + 10:
        x = 1

    distance_x = abs(ball['x'] - self_player['x'])
    distance_y = abs(ball['y'] - self_player['y'])

    # yVelocity > 0이면 공이 아래쪽으로 이동 중입니다.
    #
    # 내려오는 공이 가까워지면 점프합니다.
    if (
        self_player['state'] == 0
        and ball['yVelocity'] > 0
        and distance_x < 55
        and ball['y'] > 120
    ):
        y = -1

    # 점프 중 공과 가까워지면 hit을 시도합니다.
    if (
        self_player['state'] == 1
        and distance_x < 38
        and distance_y < 38
    ):
        hit = 1

    return {
        'x': x,
        'y': y,
        'hit': hit
    }
