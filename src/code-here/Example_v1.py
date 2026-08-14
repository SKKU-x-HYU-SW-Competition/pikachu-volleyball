# Persistent across ticks: this whole source is exec()'d once by
# botWorkerPython.js and the returned decide() closes over these module
# globals -- they are NOT reset every call.
tick_counter = 0
LOG_EVERY_N_TICKS = 20  # decide() runs every TICK_FRAME_GROUP_SIZE frames -- 20 ~= 4s
NET_X = 216  # GROUND_HALF_WIDTH, see CONTRACTS.md §1.2
PLAYER_HALF_LENGTH = 32  # half a player's hitbox width


def dodge_direction(s):
    """Which way to run to escape an incoming claw, or 0 if there is none.

    CONTRACTS.md §1.2.1: a claw is listed under the player who CAST it, so
    s['opp']['claw'] is the one aimed at us (s['self']['claw'] is ours --
    while it is not None we cannot cast again). The claw checks x only, so
    jumping never helps.
    """
    incoming = s['opp']['claw']
    if not s['config']['claw'] or incoming is None or incoming['framesUntilStrike'] <= 0:
        return 0
    danger_half_width = s['config']['claw']['width'] / 2 + PLAYER_HALF_LENGTH
    offset = s['self']['x'] - incoming['centerX']
    if abs(offset) > danger_half_width + 6:
        return 0  # already outside the range, stay on the ball instead
    if offset == 0:
        # Dead centre -- head for the middle of our own half, the direction
        # with the most room to keep running.
        return -1 if s['side'] == 'LEFT' else 1
    return 1 if offset > 0 else -1


def choose_skill_x(s):
    """x to aim our own claw at, or None for "don't cast this tick"."""
    if not s['config']['claw']:
        return None  # snapshot has no skill info (pre-v0.7 wiring)
    if s['self']['claw'] is not None:
        return None  # ours is still in flight -- casting again would be refused
    if s['self']['gauge'] < s['config']['claw']['cost']:
        return None  # cannot afford it; the cast would be silently ignored
    # Aim where the opponent has to be, not where they are: if the ball is
    # heading for their half they must go to its landing point.
    landing = s['ball']['expectedLandingPointX']
    if s['side'] == 'LEFT':
        landing_is_on_opp_half = landing > NET_X
    else:
        landing_is_on_opp_half = landing < NET_X
    return landing if landing_is_on_opp_half else s['opp']['x']


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

    # Getting clawed costs a full second of standing still, which loses the
    # rally far more reliably than one badly-positioned return does -- so
    # dodging overrides chasing the ball.
    dodge = dodge_direction(s)
    if dodge != 0:
        x = dodge

    skill_x = choose_skill_x(s)

    if tick_counter % LOG_EVERY_N_TICKS == 0:
        print(
            f"[bot {s['side']}] tick={s['tick']} state={s['self']['state']}"
            f" self=({s['self']['x']},{s['self']['y']})"
            f" ball=({s['ball']['x']},{s['ball']['y']})"
            f" landingX={s['ball']['expectedLandingPointX']}"
            f" gauge={s['self']['gauge']}/{s['opp']['gauge']}"
            f" -> x={x} y={y} hit={hit} skillX={skill_x}"
        )

    # skillX: None casts nothing, a number casts a claw centred there.
    return {'x': x, 'y': y, 'hit': hit, 'skillX': skill_x}
