"""
Example Bot 04 - Complete Bot

앞의 예제에서 사용한 이동, 착지 예측, 점프, hit을
하나의 Bot에 합친 간단한 완성형 예제입니다.

주요 내용:
- expectedLandingPointX를 이용한 수비 위치 선정
- 낮고 먼 공에 대한 간단한 dive
- jump와 hit을 동시에 입력하여 power-hit을 미리 준비
- 공중에서는 hit을 유지하여 판단 주기 사이의 hit 누락을 줄임
- 상대 위치에 따라 UP / DOWN 공격을 간단히 선택

성능을 극대화하기 위한 Bot이 아니라,
참가자가 기본 구조를 참고하고 수정하기 위한 예제입니다.
"""

NET_X = 216
PLAYER_HALF = 32
GROUND_WIDTH = 432


def is_left_side(snapshot):
    return snapshot['side'] == 'LEFT'


def is_on_my_side(snapshot, x):
    if is_left_side(snapshot):
        return x < NET_X

    return x > NET_X


def clamp_to_my_court(snapshot, x):
    if is_left_side(snapshot):
        return max(
            PLAYER_HALF,
            min(NET_X - PLAYER_HALF, x)
        )

    return max(
        NET_X + PLAYER_HALF,
        min(GROUND_WIDTH - PLAYER_HALF, x)
    )


def move_toward(current_x, target_x, dead_zone=8):
    if target_x < current_x - dead_zone:
        return -1

    if target_x > current_x + dead_zone:
        return 1

    return 0


def decide(snapshot):
    self_player = snapshot['self']
    opp = snapshot['opp']
    ball = snapshot['ball']

    ball_on_my_side = is_on_my_side(
        snapshot,
        ball['x']
    )

    landing_on_my_side = is_on_my_side(
        snapshot,
        ball['expectedLandingPointX']
    )

    distance_x = abs(
        ball['x'] - self_player['x']
    )

    distance_y = abs(
        ball['y'] - self_player['y']
    )

    # 기본 수비 위치를 정합니다.
    #
    # 공 또는 예상 착지점이 내 진영에 있으면
    # expectedLandingPointX를 따라가고,
    # 그렇지 않으면 진영 중앙 부근에서 대기합니다.
    standby_x = (
        112
        if is_left_side(snapshot)
        else 320
    )

    target_x = standby_x

    if ball_on_my_side or landing_on_my_side:
        target_x = clamp_to_my_court(
            snapshot,
            ball['expectedLandingPointX']
        )

    x = move_toward(
        self_player['x'],
        target_x
    )

    y = 0
    hit = 0

    # 1. 이미 공중에 있다면 공 쪽으로 움직이면서 hit을 유지합니다.
    #
    # Bot은 매 물리 프레임마다 새 결정을 내리는 것이 아니므로,
    # 공과 매우 가까워진 한 순간에만 hit=1을 보내면 타이밍을
    # 놓칠 수 있습니다. 따라서 공격 범위 안에서는 hit을 유지합니다.
    if (
        self_player['state'] == 1
        or self_player['state'] == 2
    ):
        x = move_toward(
            self_player['x'],
            ball['x'],
            6
        )

        # Power hit은 공이 확실히 자기 진영에 있을 때만 사용합니다.
        #
        # 네트 반대편 공까지 공격하려 하면 power hit의 수평 방향이
        # 자기 코트 쪽으로 바뀔 수 있으므로 공격하지 않습니다.
        attack_zone = ball_on_my_side

        if (
            attack_zone
            and distance_x < 82
            and distance_y < 105
        ):
            hit = 1

            # x의 절댓값이 1이면 더 빠른 power hit이 됩니다.
            x = move_toward(
                self_player['x'],
                ball['x'],
                6
            )

            if x == 0:
                x = 1 if is_left_side(snapshot) else -1

            # DOWN을 자기 코트 깊은 곳에서 사용하면
            # 네트를 넘기 전에 바닥에 떨어질 수 있습니다.
            #
            # FAST DOWN(|vx|=20)을 했다고 가정하고
            # 네트 도달 시점의 대략적인 y 위치를 계산합니다.
            frames_to_net = max(
                1,
                int(
                    (
                        abs(ball['x'] - NET_X)
                        + 19
                    ) // 20
                )
            )

            down_y_at_net = (
                ball['y']
                + frames_to_net * 30
                + (
                    frames_to_net
                    * (frames_to_net - 1)
                ) / 2
            )

            opponent_blocking = (
                abs(opp['x'] - NET_X) < 72
                and (
                    opp['state'] == 1
                    or opp['state'] == 2
                )
            )

            safe_down = down_y_at_net < 150

            # 공격 선택:
            #
            # 1. 상대가 네트에서 뛰고 있으면 UP
            # 2. DOWN이 안전하게 네트를 넘으면 DOWN
            # 3. 공이 충분히 높으면 FLAT
            # 4. 낮거나 깊은 공은 UP
            if opponent_blocking:
                y = -1
            elif safe_down:
                y = 1
            elif ball['y'] < 155:
                y = 0
            else:
                y = -1

        return {
            'x': x,
            'y': y,
            'hit': hit
        }

    # 2. 낮게 떨어지는 공이 멀리 있으면 간단한 dive를 사용합니다.
    #
    # 지상에서 x 방향과 hit=1을 함께 입력하면 dive가 됩니다.
    if (
        self_player['state'] == 0
        and ball_on_my_side
        and ball['yVelocity'] > 0
        and ball['y'] > 195
        and distance_x > 68
        and distance_x < 125
    ):
        x = (
            -1
            if ball['x'] < self_player['x']
            else 1
        )

        return {
            'x': x,
            'y': 0,
            'hit': 1
        }

    # 3. 공격 가능한 높이의 공이 가까우면
    # jump + hit을 동시에 입력합니다.
    #
    # jump를 먼저 하고 다음 decide()에서 hit을 기다리는 대신,
    # 같은 입력에서 y=-1과 hit=1을 함께 보내 power-hit 상태를
    # 미리 준비합니다.
    #
    # 이렇게 하면 판단 주기 사이에 공이 먼저 몸에 닿아
    # 일반 바운스가 되는 경우를 줄일 수 있습니다.
    # 점프 공격도 공이 자기 진영에 있을 때만 시작합니다.
    attack_zone = ball_on_my_side

    if (
        self_player['state'] == 0
        and attack_zone
        and distance_x < 62
        and ball['y'] > 100
        and ball['y'] < 190
    ):
        x = move_toward(
            self_player['x'],
            ball['x'],
            5
        )

        y = -1
        hit = 1

    return {
        'x': x,
        'y': y,
        'hit': hit
    }
