# Persistent across ticks: this whole source is exec()'d once by
# botWorkerPython.js and the returned decide() closes over these module
# globals -- they are NOT reset every call.
tick_counter = 0
LOG_EVERY_N_TICKS = 20  # decide() runs every TICK_FRAME_GROUP_SIZE frames -- 20 ~= 4s
NET_X = 216  # GROUND_HALF_WIDTH, see CONTRACTS.md §1.2

def decide(s):
    global tick_counter
    tick_counter += 1

    dx = s['ball']['expectedLandingPointX'] - s['self']['x']
    x = 0
    if abs(dx) > 8:
        x = 1 if dx > 0 else -1

    y = 0
    hit = 0
    close_enough = abs(s['ball']['x'] - s['self']['x']) < 60
    ball_above = s['ball']['y'] < s['self']['y'] - 20

    if s['self']['state'] == 0 and close_enough and ball_above and s['ball']['yVelocity'] > 0:
        y = -1  # jump to meet the ball
    if s['self']['state'] == 1 and close_enough:
        hit = 1
        # xDirection's sign does NOT steer which way the ball goes -- the
        # engine decides that from which side of the net the ball is on.
        # See Example_v1.js for the full comment.
        distance_to_net = abs(s['self']['x'] - NET_X)
        if distance_to_net < 80:
            y = 1  # close to the net -- steep smash is safe
        else:
            y = -1  # still far -- arc it over instead of driving into own court
        toward_net = -1 if s['side'] == 'RIGHT' else 1
        x = toward_net

    if tick_counter % LOG_EVERY_N_TICKS == 0:
        print(
            f"[bot {s['side']}] tick={s['tick']} state={s['self']['state']}"
            f" self=({s['self']['x']},{s['self']['y']})"
            f" ball=({s['ball']['x']},{s['ball']['y']})"
            f" landingX={s['ball']['expectedLandingPointX']}"
            f" -> x={x} y={y} hit={hit}"
        )

    return {'x': x, 'y': y, 'hit': hit}
