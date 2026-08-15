/* Strong Bot SB12.1
 *
 * SB12 offense + improved stable defense.
 *
 * Defense priority:
 *   1. Ground receive
 *   2. Dive
 *   3. Emergency jump save
 *
 * Opponent possession:
 *   - Predict actual future opponent contact
 *   - Enumerate six legal attacks from that contact
 *   - Commit to minimax defense only when contact is near
 *
 * Offense:
 *   - Two-touch possession
 *   - KILL
 *   - FORCED_DIVE
 *   - BAD_POSITION
 *   - anti-block
 *   - six legal power-hit directions
 *
 * No Thunder
 * No Tail Thunder
 * No hyper-ball
 * No net penetration
 * No glitch-dependent techniques
 *
 * Debug:
 * [SB12.1 DEF]
 * [SB12.1 RECEIVE]
 * [SB12.1 ATTACK]
 * [SB12.1 POWER]
 * [SB12.1 SAVE]
 * [SB12.1 MISS]
 */

var DEBUG = true;

var prevS = null;

var attackLock = null;

/*
 * 일반 receive를 한 번 했으면
 * 다음 접촉은 공격.
 */
var mustAttack = false;

/*
 * 방금 공격한 공을
 * 다시 건드리지 않기 위한 상태.
 */
var sentBall = false;

var receiveArmedUntil = -1;

var jumpCooldownUntil = -1;

var attackHistory = [];

/*
 * 상대 공격 예측 수비 위치.
 *
 * prediction 결과가 snapshot마다 흔들려도
 * 캐릭터가 계속 좌우로 왕복하지 않도록 기억.
 */
var defenseMemoryX = null;

var lastDefenseLogTick = -999;

var lastScoreSelf = -1;
var lastScoreOpp = -1;


/* =========================================================
 * Constants
 * ========================================================= */

var W = 432;
var NET = 216;

var HALF = 32;
var BALL_R = 20;

var PLAYER_GROUND_Y = 244;
var BALL_GROUND_Y = 252;

var NET_HALF = 25;
var NET_TOP = 176;
var NET_BOTTOM = 192;

var RUN = 6;
var DIVE = 8;

/*
 * Worker snapshot -> 실제 action 반영 사이
 * 최소 지연.
 */
var CONTROL_DELAY = 1;

/*
 * 공격을 위해 너무 먼 미래까지
 * 미리 점프하지 않는다.
 */
var ATTACK_HORIZON = 13;

/*
 * 상대의 다음 contact 탐색 범위.
 */
var OPP_CONTACT_HORIZON = 24;

/*
 * 상대 공격 이후 우리가 새 trajectory를 보고
 * 대응하는 데 필요한 작은 reaction margin.
 */
var REACTION_BUFFER = 2;


/* =========================================================
 * Helpers
 * ========================================================= */

function log() {
  if (
    !DEBUG ||
    typeof console === 'undefined'
  ) {
    return;
  }

  console.log.apply(
    console,
    arguments
  );
}


function clamp(v, lo, hi) {
  return Math.max(
    lo,
    Math.min(hi, v)
  );
}


function isLeft(s) {
  return s.side === 'LEFT';
}


function myMin(s) {
  return isLeft(s)
    ? HALF
    : NET + HALF;
}


function myMax(s) {
  return isLeft(s)
    ? NET - HALF
    : W - HALF;
}


function oppMin(s) {
  return isLeft(s)
    ? NET + HALF
    : HALF;
}


function oppMax(s) {
  return isLeft(s)
    ? W - HALF
    : NET - HALF;
}


function onMySide(s, x) {
  return isLeft(s)
    ? x < NET
    : x > NET;
}


function onOppSide(s, x) {
  return isLeft(s)
    ? x > NET
    : x < NET;
}


function inbound(s, vx) {
  return isLeft(s)
    ? vx < 0
    : vx > 0;
}


function outbound(s, vx) {
  return isLeft(s)
    ? vx > 0
    : vx < 0;
}


function moveToward(
  x,
  target,
  dead
) {
  var dz =
    dead == null
      ? 7
      : dead;

  if (
    target <
    x - dz
  ) {
    return -1;
  }

  if (
    target >
    x + dz
  ) {
    return 1;
  }

  return 0;
}


function cloneBall(ball) {
  return {
    x:
      ball.x,

    y:
      ball.y,

    vx:
      ball.xVelocity != null
        ? ball.xVelocity
        : ball.vx,

    vy:
      ball.yVelocity != null
        ? ball.yVelocity
        : ball.vy
  };
}


/*
 * 기본 수비 위치.
 *
 * 상대가 네트에 가까우면 약간 앞으로,
 * 뒤에 있으면 조금 더 뒤에서 대기.
 */
function stableStandbyX(s) {
  var oppDist =
    Math.abs(
      s.opp.x -
      NET
    );

  var dist =
    88 +
    Math.min(
      34,
      oppDist * 0.22
    );

  return clamp(
    isLeft(s)
      ? NET - dist
      : NET + dist,

    myMin(s) + 8,
    myMax(s) - 8
  );
}


/* =========================================================
 * Ball physics
 * ========================================================= */

function stepBall(b) {
  var ev = {
    ground:
      false,

    wall:
      false,

    ceiling:
      false,

    net:
      false
  };


  var futureX =
    b.x +
    b.vx;


  if (
    futureX < BALL_R ||
    futureX > W
  ) {
    b.vx =
      -b.vx;

    ev.wall =
      true;
  }


  var futureY =
    b.y +
    b.vy;


  if (
    futureY < 0
  ) {
    b.vy =
      1;

    ev.ceiling =
      true;
  }


  if (
    Math.abs(
      b.x -
      NET
    ) < NET_HALF &&
    b.y > NET_TOP
  ) {

    if (
      b.y <= NET_BOTTOM
    ) {

      if (
        b.vy > 0
      ) {
        b.vy =
          -b.vy;

        ev.net =
          true;
      }

    } else {

      b.vx =
        b.x < NET
          ? -Math.abs(b.vx)
          : Math.abs(b.vx);

      ev.net =
        true;
    }
  }


  futureY =
    b.y +
    b.vy;


  if (
    futureY >
    BALL_GROUND_Y
  ) {

    b.y =
      BALL_GROUND_Y;

    ev.ground =
      true;

    return ev;
  }


  b.y =
    futureY;

  b.x +=
    b.vx;

  b.vy +=
    1;


  return ev;
}


function simulateBall(
  ball,
  maxFrames
) {
  var b =
    cloneBall(
      ball
    );

  var path = [];


  for (
    var f = 1;
    f <= maxFrames;
    f++
  ) {

    var ev =
      stepBall(b);


    path.push({
      frame:
        f,

      x:
        b.x,

      y:
        b.y,

      vx:
        b.vx,

      vy:
        b.vy,

      ground:
        ev.ground
    });


    if (
      ev.ground
    ) {

      return {
        path:
          path,

        landed:
          true,

        landingFrame:
          f,

        landingX:
          b.x
      };
    }
  }


  return {
    path:
      path,

    landed:
      false,

    landingFrame:
      maxFrames + 1,

    landingX:
      b.x
  };
}


/*
 * 특정 contact에서 power hit을 했다고 가정.
 *
 * xAbs:
 * 0 -> |vx| = 10
 * 1 -> |vx| = 20
 *
 * yDir:
 * -1 -> UP
 *  0 -> FLAT
 * +1 -> DOWN
 */
function simulatePowerFrom(
  s,
  ball,
  xAbs,
  yDir,
  maxFrames
) {
  var b =
    cloneBall(
      ball
    );


  var baseVy =
    Math.max(
      Math.abs(
        b.vy
      ),
      15
    );


  b.vx =
    b.x < NET
      ? (xAbs + 1) * 10
      : -(xAbs + 1) * 10;


  b.vy =
    baseVy *
    yDir *
    2;


  var path = [];

  var ceiling =
    false;

  var net =
    false;


  for (
    var f = 1;
    f <= maxFrames;
    f++
  ) {

    var ev =
      stepBall(b);


    if (
      ev.ceiling
    ) {
      ceiling =
        true;
    }


    if (
      ev.net
    ) {
      net =
        true;
    }


    path.push({
      frame:
        f,

      x:
        b.x,

      y:
        b.y,

      vx:
        b.vx,

      vy:
        b.vy,

      ground:
        ev.ground
    });


    if (
      ev.ground
    ) {

      return {
        path:
          path,

        landed:
          true,

        landingFrame:
          f,

        landingX:
          b.x,

        ceiling:
          ceiling,

        net:
          net,

        safe:
          onOppSide(
            s,
            b.x
          )
      };
    }
  }


  return {
    path:
      path,

    landed:
      false,

    landingFrame:
      maxFrames + 1,

    landingX:
      b.x,

    ceiling:
      ceiling,

    net:
      net,

    safe:
      false
  };
}


/* =========================================================
 * Player movement prediction
 * ========================================================= */

function jumpYAfter(frames) {
  var y =
    PLAYER_GROUND_Y;

  var vy =
    -16;


  for (
    var i = 0;
    i < frames;
    i++
  ) {

    y +=
      vy;


    if (
      y <
      PLAYER_GROUND_Y
    ) {

      vy +=
        1;

    } else {

      y =
        PLAYER_GROUND_Y;

      break;
    }
  }


  return y;
}


function diveYAfter(frames) {
  var y =
    PLAYER_GROUND_Y;

  var vy =
    -5;


  for (
    var i = 0;
    i < frames;
    i++
  ) {

    y +=
      vy;


    if (
      y <
      PLAYER_GROUND_Y
    ) {

      vy +=
        1;

    } else {

      y =
        PLAYER_GROUND_Y;

      break;
    }
  }


  return y;
}


function estimateAirVy(
  s,
  which
) {
  var p =
    s[which];


  if (
    !prevS ||
    !prevS[which]
  ) {

    return p.y < 150
      ? 2
      : -7;
  }


  var group =
    Math.max(
      1,
      s.config
        .tickFrameGroupSize ||
        3
    );


  var dy =
    p.y -
    prevS[which].y;


  return clamp(
    Math.round(
      dy / group +
      (group + 1) / 2
    ),
    -16,
    16
  );
}


function predictExistingAirY(
  s,
  which,
  frames
) {
  var y =
    s[which].y;


  var vy =
    estimateAirVy(
      s,
      which
    );


  for (
    var i = 0;
    i < frames;
    i++
  ) {

    y +=
      vy;


    if (
      y <
      PLAYER_GROUND_Y
    ) {

      vy +=
        1;

    } else {

      y =
        PLAYER_GROUND_Y;

      break;
    }
  }


  return y;
}


function predictedOpponentX(
  s,
  frames
) {
  var x =
    s.opp.x;


  if (
    !prevS
  ) {

    return clamp(
      x,
      oppMin(s),
      oppMax(s)
    );
  }


  var group =
    Math.max(
      1,
      s.config
        .tickFrameGroupSize ||
        3
    );


  var vx =
    clamp(
      (
        s.opp.x -
        prevS.opp.x
      ) /
      group,

      -RUN,
      RUN
    );


  x +=
    vx *
    Math.min(
      frames,
      12
    );


  return clamp(
    x,
    oppMin(s),
    oppMax(s)
  );
}


function opponentMotion(s) {
  if (
    !prevS
  ) {
    return 0;
  }


  var dx =
    s.opp.x -
    prevS.opp.x;


  if (
    Math.abs(dx) < 2
  ) {
    return 0;
  }


  return dx > 0
    ? 1
    : -1;
}


/* =========================================================
 * Generic reachability
 * ========================================================= */

function canPlayerTouchPoint(
  s,
  which,
  point,
  frame
) {
  var p =
    s[which];


  var lo =
    which === 'self'
      ? myMin(s)
      : oppMin(s);


  var hi =
    which === 'self'
      ? myMax(s)
      : oppMax(s);


  var targetX =
    clamp(
      point.x,
      lo,
      hi
    );


  /*
   * Horizontal reach.
   */
  if (
    Math.abs(
      targetX -
      p.x
    ) >
    RUN *
      frame +
    HALF
  ) {
    return false;
  }


  /*
   * Ground body receive.
   */
  if (
    Math.abs(
      point.y -
      PLAYER_GROUND_Y
    ) <= HALF
  ) {
    return true;
  }


  /*
   * 이미 공중.
   */
  if (
    p.state === 1 ||
    p.state === 2 ||
    p.state === 3
  ) {

    return (
      Math.abs(
        point.y -
        predictExistingAirY(
          s,
          which,
          frame
        )
      ) <= HALF
    );
  }


  if (
    p.state !== 0
  ) {
    return false;
  }


  /*
   * 가능한 jump timing들을 검사.
   */
  var maxDelay =
    Math.min(
      9,
      frame - 1
    );


  for (
    var delay = 0;
    delay <= maxDelay;
    delay++
  ) {

    var airFrames =
      frame -
      delay;


    if (
      airFrames > 0 &&

      Math.abs(
        point.y -
        jumpYAfter(
          airFrames
        )
      ) <= HALF
    ) {

      return true;
    }
  }


  return false;
}


/* =========================================================
 * Opponent future contact
 * ========================================================= */

function findOpponentContact(
  s,
  currentPath
) {
  var limit =
    Math.min(
      OPP_CONTACT_HORIZON,
      currentPath.path.length
    );


  for (
    var i = 0;
    i < limit;
    i++
  ) {

    var p =
      currentPath.path[i];


    if (
      !onOppSide(
        s,
        p.x
      )
    ) {
      continue;
    }


    if (
      canPlayerTouchPoint(
        s,
        'opp',
        p,
        p.frame
      )
    ) {

      return {
        frame:
          p.frame,

        point:
          p
      };
    }
  }


  return null;
}


/* =========================================================
 * Opponent six-shot threats
 * ========================================================= */

function buildOpponentThreats(
  s,
  contact
) {
  if (
    !contact
  ) {
    return [];
  }


  var threats = [];


  var ball = {
    x:
      contact.point.x,

    y:
      contact.point.y,

    vx:
      contact.point.vx,

    vy:
      contact.point.vy
  };


  for (
    var xAbs = 0;
    xAbs <= 1;
    xAbs++
  ) {

    for (
      var yDir = -1;
      yDir <= 1;
      yDir++
    ) {

      var out =
        simulatePowerFrom(
          s,
          ball,
          xAbs,
          yDir,
          70
        );


      if (
        !out.landed ||
        !onMySide(
          s,
          out.landingX
        )
      ) {
        continue;
      }


      threats.push({
        xAbs:
          xAbs,

        yDir:
          yDir,

        landingX:
          out.landingX,

        landingFrame:
          out.landingFrame,

        totalFrame:
          contact.frame +
          out.landingFrame,

        path:
          out.path
      });
    }
  }


  return threats;
}


/* =========================================================
 * Improved minimax defense
 * ========================================================= */

function chooseThreatDefenseTarget(
  s,
  contact,
  threats
) {
  if (
    !contact ||
    threats.length === 0
  ) {
    return null;
  }


  /*
   * SB12.1 핵심 변경.
   *
   * 상대 contact가 아직 멀면
   * 매 snapshot마다 바뀌는 미래 예측에
   * 휘둘리지 않는다.
   */
  if (
    contact.frame > 8
  ) {

    if (
      defenseMemoryX == null
    ) {

      defenseMemoryX =
        stableStandbyX(
          s
        );
    }


    return Math.round(
      defenseMemoryX
    );
  }


  /*
   * 상대 contact 전까지
   * 실제 우리가 이동 가능한 영역.
   */
  var moveFrames =
    Math.max(
      1,
      contact.frame -
      CONTROL_DELAY
    );


  var reachableLo =
    clamp(
      s.self.x -
        RUN *
        moveFrames,

      myMin(s) + 6,
      myMax(s) - 6
    );


  var reachableHi =
    clamp(
      s.self.x +
        RUN *
        moveFrames,

      myMin(s) + 6,
      myMax(s) - 6
    );


  var oldTarget =
    defenseMemoryX == null
      ? s.self.x
      : defenseMemoryX;


  var bestX =
    clamp(
      oldTarget,
      reachableLo,
      reachableHi
    );


  var bestScore =
    -1e18;


  for (
    var x =
      myMin(s) + 6;

    x <=
      myMax(s) - 6;

    x += 6
  ) {

    if (
      x < reachableLo ||
      x > reachableHi
    ) {
      continue;
    }


    var coverageScore =
      0;


    var worstMiss =
      0;


    for (
      var i = 0;
      i < threats.length;
      i++
    ) {

      var th =
        threats[i];


      /*
       * 상대가 실제 hit한 이후
       * 우리에게 남는 대응 시간.
       */
      var receiveFrames =
        Math.max(
          0,
          th.landingFrame -
          REACTION_BUFFER
        );


      var runReach =
        RUN *
          receiveFrames +
        HALF;


      var miss =
        Math.max(
          0,

          Math.abs(
            th.landingX -
            x
          ) -
          runReach
        );


      /*
       * 빠른 공격일수록
       * 수비 positioning에서 더 중요.
       */
      var urgency =
        1 +
        10 /
        Math.max(
          5,
          th.landingFrame
        );


      if (
        miss <= 0
      ) {

        coverageScore +=
          1000 *
          urgency;

      } else {

        coverageScore -=
          miss *
          18 *
          urgency;
      }


      if (
        miss >
        worstMiss
      ) {

        worstMiss =
          miss;
      }
    }


    /*
     * 이전 target에서 갑자기
     * 반대 방향으로 이동하는 것을 억제.
     */
    var switchCost =
      Math.abs(
        x -
        oldTarget
      ) *
      5;


    /*
     * 현재 위치에서 너무 큰 이동 역시
     * 작은 비용 부여.
     */
    var moveCost =
      Math.abs(
        x -
        s.self.x
      ) *
      1.5;


    var score =
      coverageScore -
      worstMiss *
      25 -
      switchCost -
      moveCost;


    if (
      score >
      bestScore
    ) {

      bestScore =
        score;


      bestX =
        x;
    }
  }


  /*
   * 12px 미만의 target 변화는
   * 굳이 따라가지 않는다.
   */
  if (
    Math.abs(
      bestX -
      oldTarget
    ) < 12
  ) {

    bestX =
      oldTarget;
  }


  defenseMemoryX =
    clamp(
      bestX,
      myMin(s) + 6,
      myMax(s) - 6
    );


  return Math.round(
    defenseMemoryX
  );
}


function maybeLogDefense(
  s,
  contact,
  threats,
  target
) {
  if (
    !DEBUG ||
    target == null
  ) {
    return;
  }


  if (
    s.tick -
      lastDefenseLogTick >=
    15
  ) {

    log(
      '[SB12.1 DEF]',
      'tick=' +
        s.tick,

      'oppContact=' +
        contact.frame,

      'threats=' +
        threats.length,

      'target=' +
        Math.round(
          target
        )
    );


    lastDefenseLogTick =
      s.tick;
  }
}


/* =========================================================
 * Ground receive
 * ========================================================= */

function findGroundReceive(
  s,
  sim
) {
  if (
    s.self.state !== 0
  ) {
    return null;
  }


  for (
    var i = 0;
    i < sim.path.length;
    i++
  ) {

    var p =
      sim.path[i];


    if (
      !onMySide(
        s,
        p.x
      )
    ) {
      continue;
    }


    if (
      p.vy <= 0
    ) {
      continue;
    }


    /*
     * 실제 collision 범위 기준.
     */
    if (
      Math.abs(
        p.y -
        PLAYER_GROUND_Y
      ) > HALF
    ) {
      continue;
    }


    var active =
      Math.max(
        0,
        p.frame -
        CONTROL_DELAY
      );


    var targetX =
      clamp(
        p.x,
        myMin(s),
        myMax(s)
      );


    var need =
      Math.max(
        0,

        Math.abs(
          targetX -
          s.self.x
        ) -
        (
          HALF -
          3
        )
      );


    if (
      need <=
      RUN *
      active
    ) {

      return {
        frame:
          p.frame,

        targetX:
          targetX,

        point:
          p
      };
    }
  }


  return null;
}


/* =========================================================
 * Dive receive
 * ========================================================= */

function findDiveReceive(
  s,
  sim
) {
  if (
    s.self.state !== 0
  ) {
    return null;
  }


  for (
    var i = 0;
    i < sim.path.length &&
    i < 18;
    i++
  ) {

    var p =
      sim.path[i];


    if (
      !onMySide(
        s,
        p.x
      )
    ) {
      continue;
    }


    if (
      p.vy <= 0
    ) {
      continue;
    }


    var active =
      Math.max(
        1,

        p.frame -
        CONTROL_DELAY
      );


    var playerY =
      diveYAfter(
        Math.max(
          0,
          active - 1
        )
      );


    var targetX =
      clamp(
        p.x,
        myMin(s),
        myMax(s)
      );


    var dx =
      targetX -
      s.self.x;


    if (
      Math.abs(
        p.y -
        playerY
      ) >
      HALF + 8
    ) {
      continue;
    }


    /*
     * 가까운 공에는 dive하지 않는다.
     */
    if (
      Math.abs(dx) <
      64
    ) {
      continue;
    }


    var reach =
      6 +
      Math.max(
        0,
        active - 1
      ) *
        DIVE +
      HALF -
      4;


    if (
      Math.abs(dx) <=
      reach
    ) {

      return {
        frame:
          p.frame,

        targetX:
          targetX,

        direction:
          dx > 0
            ? 1
            : -1,

        point:
          p
      };
    }
  }


  return null;
}


/* =========================================================
 * Improved emergency jump save
 *
 * Ground와 Dive가 모두 불가능할 때만.
 *
 * 먼 공을 보고 점프하는 행동 제거.
 * ========================================================= */

function findEmergencyJumpSave(
  s,
  sim
) {
  if (
    s.self.state !== 0
  ) {
    return null;
  }


  for (
    var i = 0;
    i < sim.path.length &&
    i < 8;
    i++
  ) {

    var p =
      sim.path[i];


    if (
      !onMySide(
        s,
        p.x
      )
    ) {
      continue;
    }


    /*
     * 내려오는 공만.
     */
    if (
      p.vy <= 0
    ) {
      continue;
    }


    var active =
      p.frame -
      CONTROL_DELAY;


    if (
      active < 2 ||
      active > 6
    ) {
      continue;
    }


    /*
     * 너무 낮으면
     * jump가 아니라 ground/dive 영역.
     */
    if (
      p.y > 198
    ) {
      continue;
    }


    var horizontalGap =
      Math.abs(
        p.x -
        s.self.x
      );


    /*
     * SB12.1 핵심:
     * 먼 공 수비 점프 금지.
     */
    if (
      horizontalGap > 72
    ) {
      continue;
    }


    var playerY =
      jumpYAfter(
        active
      );


    if (
      Math.abs(
        p.y -
        playerY
      ) >
      HALF - 2
    ) {
      continue;
    }


    if (
      horizontalGap >
      RUN *
        active +
      HALF -
        5
    ) {
      continue;
    }


    return {
      frame:
        p.frame,

      targetX:
        clamp(
          p.x,
          myMin(s),
          myMax(s)
        ),

      point:
        p
    };
  }


  return null;
}


function armReceiveWatch(
  s,
  frame
) {
  var group =
    Math.max(
      1,
      s.config
        .tickFrameGroupSize ||
        3
    );


  if (
    frame <=
    group + 5
  ) {

    receiveArmedUntil =
      Math.max(
        receiveArmedUntil,

        s.tick +
        frame +
        group +
        2
      );
  }
}


/* =========================================================
 * Receive detection
 * ========================================================= */

function nearSelfNowOrPrev(s) {
  var now =
    Math.abs(
      s.ball.x -
      s.self.x
    ) <= 66 &&

    Math.abs(
      s.ball.y -
      s.self.y
    ) <= 82;


  if (
    now
  ) {
    return true;
  }


  if (
    !prevS
  ) {
    return false;
  }


  return (
    Math.abs(
      prevS.ball.x -
      prevS.self.x
    ) <= 66 &&

    Math.abs(
      prevS.ball.y -
      prevS.self.y
    ) <= 82
  );
}


function detectNormalReceive(s) {
  if (
    !prevS ||
    sentBall ||

    !onMySide(
      s,
      s.ball.x
    )
  ) {
    return false;
  }


  var evidence =
    nearSelfNowOrPrev(
      s
    ) ||

    receiveArmedUntil >=
      s.tick;


  if (
    !evidence
  ) {
    return false;
  }


  /*
   * 우리 power hit은 receive가 아니다.
   */
  if (
    s.ball
      .isPowerHit === true &&

    outbound(
      s,
      s.ball.xVelocity
    )
  ) {
    return false;
  }


  var bouncedUp =
    prevS.ball
      .yVelocity > 0 &&

    s.ball
      .yVelocity < -4;


  var dvx =
    Math.abs(
      s.ball.xVelocity -
      prevS.ball.xVelocity
    );


  var dvy =
    Math.abs(
      s.ball.yVelocity -
      prevS.ball.yVelocity
    );


  var powerEnded =
    prevS.ball
      .isPowerHit === true &&

    s.ball
      .isPowerHit === false;


  return (
    s.ball
      .yVelocity < -2 &&

    (
      bouncedUp ||
      dvx >= 7 ||
      dvy >= 10 ||
      powerEnded
    )
  );
}


/* =========================================================
 * Two-touch possession
 * ========================================================= */

function updatePossession(s) {
  if (
    sentBall &&

    onOppSide(
      s,
      s.ball.x
    )
  ) {

    sentBall =
      false;

    mustAttack =
      false;

    receiveArmedUntil =
      -1;

    return;
  }


  if (
    sentBall
  ) {
    return;
  }


  if (
    detectNormalReceive(
      s
    )
  ) {

    if (
      !mustAttack
    ) {

      log(
        '[SB12.1 RECEIVE]',
        'tick=' +
          s.tick,

        'ball=' +
          Math.round(
            s.ball.x
          ) +
          ',' +
          Math.round(
            s.ball.y
          ),

        'v=' +
          s.ball.xVelocity +
          ',' +
          s.ball.yVelocity
      );
    }


    mustAttack =
      true;


    receiveArmedUntil =
      -1;
  }


  if (
    onOppSide(
      s,
      s.ball.x
    )
  ) {

    mustAttack =
      false;

    receiveArmedUntil =
      -1;
  }
}


/* =========================================================
 * Self attack contact prediction
 * ========================================================= */

function predictAttackContact(
  s,
  xAbs
) {
  if (
    s.self.state !== 0
  ) {
    return null;
  }


  var b =
    cloneBall(
      s.ball
    );


  var px =
    s.self.x;


  var py =
    s.self.y;


  var pvy =
    0;


  var started =
    false;


  for (
    var f = 1;
    f <= ATTACK_HORIZON;
    f++
  ) {

    var ev =
      stepBall(b);


    if (
      ev.ground
    ) {
      return null;
    }


    if (
      f >
      CONTROL_DELAY
    ) {

      var xDir =
        0;


      if (
        xAbs === 1
      ) {

        xDir =
          moveToward(
            px,
            b.x,
            3
          );


        if (
          xDir === 0
        ) {

          xDir =
            isLeft(s)
              ? 1
              : -1;
        }
      }


      px =
        clamp(
          px +
            xDir *
            RUN,

          myMin(s),
          myMax(s)
        );


      if (
        !started
      ) {

        started =
          true;

        pvy =
          -16;
      }


      py +=
        pvy;


      if (
        py <
        PLAYER_GROUND_Y
      ) {

        pvy +=
          1;

      } else {

        py =
          PLAYER_GROUND_Y;

        pvy =
          0;
      }
    }


    /*
     * 실제 collision box.
     */
    if (
      Math.abs(
        b.x -
        px
      ) <= HALF &&

      Math.abs(
        b.y -
        py
      ) <= HALF
    ) {

      return {
        frame:
          f,

        ball: {
          x:
            b.x,

          y:
            b.y,

          vx:
            b.vx,

          vy:
            b.vy
        },

        playerX:
          px,

        playerY:
          py,

        aligned:
          Math.abs(
            b.x -
            px
          ) <= 12
      };
    }
  }


  return null;
}


/* =========================================================
 * Shot helpers
 * ========================================================= */

function shotName(
  xAbs,
  yDir
) {
  var speed =
    xAbs === 1
      ? 'FAST_'
      : 'SLOW_';


  if (
    yDir === 1
  ) {
    return speed +
      'DOWN';
  }


  if (
    yDir === 0
  ) {
    return speed +
      'FLAT';
  }


  return speed +
    'UP';
}


function historyPenalty(name) {
  var p = 0;


  for (
    var i = 0;
    i < attackHistory.length;
    i++
  ) {

    if (
      attackHistory[i] ===
      name
    ) {

      p +=
        (
          attackHistory.length -
          i
        ) *
        90;
    }
  }


  return p;
}


function rememberAttack(name) {
  if (
    !name
  ) {
    return;
  }


  attackHistory.push(
    name
  );


  while (
    attackHistory.length >
    4
  ) {

    attackHistory.shift();
  }
}


/* =========================================================
 * Opponent reach after our attack
 * ========================================================= */

function canOpponentReachAttackPoint(
  s,
  point,
  totalFromNow
) {
  var targetX =
    clamp(
      point.x,
      oppMin(s),
      oppMax(s)
    );


  var oppX =
    predictedOpponentX(
      s,
      Math.min(
        totalFromNow,
        10
      )
    );


  if (
    Math.abs(
      targetX -
      oppX
    ) >
    RUN *
      Math.max(
        0,
        totalFromNow -
        REACTION_BUFFER
      ) +
    HALF
  ) {
    return false;
  }


  /*
   * Ground receive.
   */
  if (
    Math.abs(
      point.y -
      PLAYER_GROUND_Y
    ) <= HALF
  ) {
    return true;
  }


  if (
    s.opp.state === 1 ||
    s.opp.state === 2 ||
    s.opp.state === 3
  ) {

    return (
      Math.abs(
        point.y -
        predictExistingAirY(
          s,
          'opp',
          totalFromNow
        )
      ) <= HALF
    );
  }


  if (
    s.opp.state !== 0
  ) {
    return false;
  }


  var available =
    Math.max(
      1,
      totalFromNow -
      REACTION_BUFFER
    );


  var maxDelay =
    Math.min(
      8,
      available - 1
    );


  for (
    var delay = 0;
    delay <= maxDelay;
    delay++
  ) {

    var airFrames =
      available -
      delay;


    if (
      airFrames > 0 &&

      Math.abs(
        point.y -
        jumpYAfter(
          airFrames
        )
      ) <= HALF
    ) {

      return true;
    }
  }


  return false;
}


/* =========================================================
 * Purposeful attack evaluation
 *
 * KILL
 * FORCED_DIVE
 * BAD_POSITION
 * NORMAL
 * ========================================================= */

function evaluateAttack(
  s,
  contact,
  xAbs,
  yDir
) {
  if (
    !contact
  ) {
    return null;
  }


  /*
   * SLOW 공격은 x=0이므로
   * 이미 contact line에 정렬된 경우만.
   */
  if (
    xAbs === 0 &&
    !contact.aligned
  ) {
    return null;
  }


  var group =
    Math.max(
      1,
      s.config
        .tickFrameGroupSize ||
        3
    );


  var directionReady =
    group +
    CONTROL_DELAY +
    1;


  /*
   * 최초 pre-arm input은 y=-1.
   *
   * DOWN/FLAT을 전달하기 전에 collision할 상황이면 제외.
   */
  if (
    yDir !== -1 &&

    contact.frame <=
    directionReady
  ) {
    return null;
  }


  var out =
    simulatePowerFrom(
      s,
      contact.ball,
      xAbs,
      yDir,
      80
    );


  if (
    !out.landed ||
    !out.safe ||

    !onOppSide(
      s,
      out.landingX
    )
  ) {
    return null;
  }


  var firstIntercept =
    999;


  var blockRisk =
    false;


  for (
    var i = 0;
    i < out.path.length;
    i++
  ) {

    var p =
      out.path[i];


    if (
      !onOppSide(
        s,
        p.x
      )
    ) {
      continue;
    }


    var total =
      contact.frame +
      p.frame;


    if (
      canOpponentReachAttackPoint(
        s,
        p,
        total
      )
    ) {

      if (
        firstIntercept === 999
      ) {

        firstIntercept =
          p.frame;
      }


      if (
        p.frame <= 6 &&

        Math.abs(
          p.x -
          NET
        ) <=
        HALF + 14 &&

        p.y <
        PLAYER_GROUND_Y - 8
      ) {

        blockRisk =
          true;
      }
    }
  }


  var oppAtContact =
    predictedOpponentX(
      s,
      contact.frame
    );


  var runFrames =
    Math.max(
      0,
      out.landingFrame -
      REACTION_BUFFER
    );


  var runCapacity =
    RUN *
      runFrames +
    HALF;


  var diveCapacity =
    DIVE *
      runFrames +
    HALF;


  var landingDistance =
    Math.abs(
      out.landingX -
      oppAtContact
    );


  var tier;
  var tierName;


  if (
    firstIntercept === 999
  ) {

    tier =
      4;

    tierName =
      'KILL';

  } else if (
    !blockRisk &&
    landingDistance >
      runCapacity &&
    landingDistance <=
      diveCapacity
  ) {

    tier =
      3;

    tierName =
      'FORCED_DIVE';

  } else if (
    !blockRisk &&
    landingDistance >
      runCapacity *
      0.72
  ) {

    tier =
      2;

    tierName =
      'BAD_POSITION';

  } else {

    tier =
      1;

    tierName =
      'NORMAL';
  }


  var score =
    tier *
    10000;


  if (
    blockRisk
  ) {
    score -=
      5000;
  }


  score +=
    landingDistance *
    7;


  score -=
    out.landingFrame *
    18;


  /*
   * 상대 움직임 반대.
   */
  var motion =
    opponentMotion(
      s
    );


  if (
    motion > 0 &&
    out.landingX <
      s.opp.x - 8
  ) {

    score +=
      320;
  }


  if (
    motion < 0 &&
    out.landingX >
      s.opp.x + 8
  ) {

    score +=
      320;
  }


  var oppNearNet =
    Math.abs(
      s.opp.x -
      NET
    ) < 78;


  var oppBack =
    Math.abs(
      s.opp.x -
      NET
    ) > 118;


  var landingNearNet =
    Math.abs(
      out.landingX -
      NET
    ) < 78;


  var landingDeep =
    Math.abs(
      out.landingX -
      NET
    ) > 125;


  /*
   * 상대 뒤 -> short.
   */
  if (
    oppBack &&
    landingNearNet
  ) {

    score +=
      700;
  }


  /*
   * 상대 앞 -> deep.
   */
  if (
    oppNearNet &&
    landingDeep
  ) {

    score +=
      650;
  }


  /*
   * 높은 타점 DOWN.
   */
  if (
    yDir === 1 &&
    contact.ball.y < 160
  ) {

    score +=
      380;
  }


  /*
   * FAST FLAT pressure.
   */
  if (
    yDir === 0 &&
    xAbs === 1
  ) {

    score +=
      180;
  }


  /*
   * UP은 기본 공격이 아니라
   * 우회용.
   */
  if (
    yDir === -1
  ) {

    score -=
      220;
  }


  if (
    out.ceiling
  ) {

    score -=
      blockRisk
        ? 40
        : 260;
  }


  if (
    blockRisk &&
    yDir === -1
  ) {

    score +=
      700;
  }


  score -=
    historyPenalty(
      shotName(
        xAbs,
        yDir
      )
    );


  return {
    name:
      shotName(
        xAbs,
        yDir
      ),

    xAbs:
      xAbs,

    yDir:
      yDir,

    contact:
      contact,

    tier:
      tier,

    tierName:
      tierName,

    score:
      score,

    blockRisk:
      blockRisk,

    firstIntercept:
      firstIntercept,

    landingX:
      out.landingX,

    landingFrame:
      out.landingFrame
  };
}


/* =========================================================
 * Enumerate six attacks
 * ========================================================= */

function chooseAttackPlan(s) {
  if (
    s.self.state !== 0 ||
    !onMySide(
      s,
      s.ball.x
    ) ||
    s.tick <=
      jumpCooldownUntil
  ) {
    return null;
  }


  var contacts = [
    predictAttackContact(
      s,
      0
    ),

    predictAttackContact(
      s,
      1
    )
  ];


  var best =
    null;


  for (
    var xAbs = 0;
    xAbs <= 1;
    xAbs++
  ) {

    var contact =
      contacts[xAbs];


    if (
      !contact
    ) {
      continue;
    }


    for (
      var yDir = -1;
      yDir <= 1;
      yDir++
    ) {

      var candidate =
        evaluateAttack(
          s,
          contact,
          xAbs,
          yDir
        );


      if (
        !candidate
      ) {
        continue;
      }


      if (
        !best ||
        candidate.score >
        best.score
      ) {

        best =
          candidate;
      }
    }
  }


  return best;
}


/* =========================================================
 * Serve / one-touch rules
 * ========================================================= */

function isMyServe(s) {
  return isLeft(s)
    ? !s.meta.isPlayer2Serve
    : s.meta.isPlayer2Serve;
}


/*
 * SB12.1:
 *
 * 수비를 포기하면서까지 one-touch 하는 기준을 강화.
 */
function shouldTakeOneTouchAttack(
  s,
  plan
) {
  if (
    !plan
  ) {
    return false;
  }


  /*
   * Serve는 공격.
   */
  var serve =
    isMyServe(
      s
    ) &&
    s.meta
      .rallyFrameCount <
      55;


  if (
    serve
  ) {
    return true;
  }


  /*
   * 상대에서 실제 들어오는 공만.
   */
  if (
    !inbound(
      s,
      s.ball.xVelocity
    )
  ) {
    return false;
  }


  /*
   * KILL은 바로 counter.
   */
  if (
    plan.tier >= 4
  ) {
    return true;
  }


  /*
   * FORCED_DIVE는
   * 네트 근처 + 높은 공 + 빠른 contact일 때만.
   *
   * 깊은 코트에서는 안정적인 receive 우선.
   */
  if (
  plan.tier === 3 &&
  !plan.blockRisk &&

  /*
   * 먼 미래 contact를 노린
   * 위험한 counter는 하지 않는다.
   */
  plan.contact.frame <= 7 &&

  /*
   * net 근처에서만 적극 counter.
   */
  Math.abs(
    s.ball.x -
    NET
  ) < 82 &&

  /*
   * 현재 공 높이가 아니라
   * 실제 예상 contact 시점의 높이를 검사.
   *
   * 낮은 타점에서 억지로 점프 공격하다
   * 공이 아래로 빠지는 상황 방지.
   */
  plan.contact.ball.y < 165
) {

  return true;
}


  return false;
}


/* =========================================================
 * Attack actuator
 * ========================================================= */

function attackXInput(
  s,
  xAbs
) {
  if (
    xAbs === 0
  ) {
    return 0;
  }


  var x =
    moveToward(
      s.self.x,
      s.ball.x,
      3
    );


  if (
    x !== 0
  ) {
    return x;
  }


  return isLeft(s)
    ? 1
    : -1;
}


function startAttack(
  s,
  plan,
  reason
) {
  attackLock = {
    startedTick:
      s.tick,

    expectedContactTick:
      s.tick +
      plan.contact.frame,

    reason:
      reason,

    name:
      plan.name,

    xAbs:
      plan.xAbs,

    yDir:
      plan.yDir,

    tierName:
      plan.tierName,

    sawState2:
      false,

    sawNear:
      false
  };


  log(
    '[SB12.1 ATTACK]',
    'tick=' +
      s.tick,

    'reason=' +
      reason,

    'shot=' +
      plan.name,

    'purpose=' +
      plan.tierName,

    'contact=' +
      plan.contact.frame,

    'landing=' +
      Math.round(
        plan.landingX
      ),

    'block=' +
      plan.blockRisk
  );


  /*
   * jump + hit을 동시에 보내
   * state2를 미리 준비.
   */
  return {
    x:
      attackXInput(
        s,
        plan.xAbs
      ),

    y:
      -1,

    hit:
      1
  };
}


function attackSucceeded(s) {
  if (
    !attackLock
  ) {
    return false;
  }


  if (
    s.self.state === 2
  ) {

    attackLock.sawState2 =
      true;
  }


  var near =
    Math.abs(
      s.ball.x -
      s.self.x
    ) <= 58 &&

    Math.abs(
      s.ball.y -
      s.self.y
    ) <= 72;


  if (
    near
  ) {

    attackLock.sawNear =
      true;
  }


  if (
    !s.ball.isPowerHit ||
    !outbound(
      s,
      s.ball.xVelocity
    )
  ) {
    return false;
  }


  return (
    attackLock.sawState2 &&
    (
      attackLock.sawNear ||
      near
    )
  );
}


function handleAttackLock(s) {
  if (
    !attackLock
  ) {
    return null;
  }


  if (
    s.self.state === 2
  ) {

    attackLock.sawState2 =
      true;
  }


  if (
    attackSucceeded(
      s
    )
  ) {

    log(
      '[SB12.1 POWER]',
      'tick=' +
        s.tick,

      'shot=' +
        attackLock.name,

      'purpose=' +
        attackLock.tierName,

      'v=' +
        s.ball.xVelocity +
        ',' +
        s.ball.yVelocity
    );


    rememberAttack(
      attackLock.name
    );


    attackLock =
      null;

    mustAttack =
      false;

    sentBall =
      true;

    receiveArmedUntil =
      -1;


    return null;
  }


  /*
   * 이미 상대 코트로 outgoing이면
   * snapshot 사이에서 power 순간을 놓쳤어도
   * 재공격하지 않는다.
   */
  if (
    onOppSide(
      s,
      s.ball.x
    ) &&
    outbound(
      s,
      s.ball.xVelocity
    )
  ) {

    rememberAttack(
      attackLock.name
    );


    attackLock =
      null;

    mustAttack =
      false;

    sentBall =
      true;

    receiveArmedUntil =
      -1;


    return null;
  }


  var age =
    s.tick -
    attackLock.startedTick;


  /*
   * 공격 시작 뒤에는
   * 방향을 contact까지 유지.
   */
  if (
    s.self.state === 1 ||
    s.self.state === 2
  ) {

    return {
      x:
        attackXInput(
          s,
          attackLock.xAbs
        ),

      y:
        attackLock.yDir,

      hit:
        1
    };
  }


  /*
   * Worker latency로 stale ground snapshot이
   * 한 번 더 보이는 경우.
   */
  if (
    s.self.state === 0 &&
    age <= 4
  ) {

    return {
      x:
        attackXInput(
          s,
          attackLock.xAbs
        ),

      y:
        -1,

      hit:
        1
    };
  }


  if (
    age > 18 ||
    s.tick >
      attackLock
        .expectedContactTick +
      7
  ) {

    log(
      '[SB12.1 MISS]',
      'tick=' +
        s.tick,

      'shot=' +
        attackLock.name,

      'state=' +
        s.self.state,

      'ball=' +
        Math.round(
          s.ball.x
        ) +
        ',' +
        Math.round(
          s.ball.y
        )
    );


    attackLock =
      null;


    jumpCooldownUntil =
      s.tick + 4;


    if (
      onMySide(
        s,
        s.ball.x
      )
    ) {

      mustAttack =
        true;
    }


    return null;
  }


  return {
    x:
      attackXInput(
        s,
        attackLock.xAbs
      ),

    y:
      attackLock.yDir,

    hit:
      1
  };
}


/* =========================================================
 * Emergency anti-trap clear
 * ========================================================= */

function emergencyClearPlan(s) {
  if (
    !mustAttack ||
    s.self.state !== 0 ||
    !onMySide(
      s,
      s.ball.x
    )
  ) {
    return null;
  }


  if (
    s.ball
      .yVelocity <= 0 ||

    Math.abs(
      s.ball.x -
      s.self.x
    ) > 48 ||

    Math.abs(
      s.ball.y -
      s.self.y
    ) > 82
  ) {
    return null;
  }


  var contact =
    predictAttackContact(
      s,
      1
    );


  if (
    !contact
  ) {
    return null;
  }


  /*
   * 늦은 상황에서는
   * 최초 y=-1과 일치하는 FAST UP.
   */
  return evaluateAttack(
    s,
    contact,
    1,
    -1
  );
}


/* =========================================================
 * Direct defense
 * ========================================================= */

function directDefenseAction(
  s,
  sim
) {
  /*
   * 1.
   * Ground receive 최우선.
   */
  var ground =
    findGroundReceive(
      s,
      sim
    );


  if (
    ground
  ) {

    armReceiveWatch(
      s,
      ground.frame
    );


    return {
      action: {
        x:
          moveToward(
            s.self.x,
            ground.targetX,
            4
          ),

        y:
          0,

        hit:
          0
      },

      mode:
        'GROUND'
    };
  }


  /*
   * 2.
   * Ground로 못 받으면 Dive.
   */
  var dive =
    findDiveReceive(
      s,
      sim
    );


  if (
    dive
  ) {

    armReceiveWatch(
      s,
      dive.frame
    );


    var group =
      Math.max(
        1,
        s.config
          .tickFrameGroupSize ||
          3
      );


    if (
      dive.frame <=
      group + 2
    ) {

      log(
        '[SB12.1 SAVE]',
        'tick=' +
          s.tick,

        'type=DIVE',

        'frame=' +
          dive.frame
      );


      return {
        action: {
          x:
            dive.direction,

          y:
            0,

          hit:
            1
        },

        mode:
          'DIVE'
      };
    }


    return {
      action: {
        x:
          moveToward(
            s.self.x,
            dive.targetX,
            4
          ),

        y:
          0,

        hit:
          0
      },

      mode:
        'DIVE_SETUP'
    };
  }


  /*
   * 3.
   * Ground와 Dive가 모두 불가능할 때만
   * 자기 근처의 높은 공에 Jump Save.
   */
  var jump =
    findEmergencyJumpSave(
      s,
      sim
    );


  if (
    jump
  ) {

    armReceiveWatch(
      s,
      jump.frame
    );


    log(
      '[SB12.1 SAVE]',
      'tick=' +
        s.tick,

      'type=JUMP',

      'frame=' +
        jump.frame
    );


    return {
      action: {
        x:
          moveToward(
            s.self.x,
            jump.targetX,
            4
          ),

        y:
          -1,

        hit:
          0
      },

      mode:
        'JUMP_SAVE'
    };
  }


  /*
   * 어떤 receive 방법도 명확하지 않으면
   * 예상 착지점으로 끝까지 따라감.
   */
  var target =
    stableStandbyX(
      s
    );


  if (
    sim.landed &&
    onMySide(
      s,
      sim.landingX
    )
  ) {

    target =
      clamp(
        sim.landingX,
        myMin(s),
        myMax(s)
      );
  }


  return {
    action: {
      x:
        moveToward(
          s.self.x,
          target,
          6
        ),

      y:
        0,

      hit:
        0
    },

    mode:
      'FALLBACK'
  };
}


/* =========================================================
 * Rally reset
 * ========================================================= */

function resetRally(s) {
  attackLock =
    null;

  mustAttack =
    false;

  sentBall =
    false;

  receiveArmedUntil =
    -1;

  jumpCooldownUntil =
    -1;

  defenseMemoryX =
    null;

  lastDefenseLogTick =
    -999;


  lastScoreSelf =
    s.meta.score.self;

  lastScoreOpp =
    s.meta.score.opp;
}


function maybeResetRally(s) {
  var scoreChanged =
    s.meta.score.self !==
      lastScoreSelf ||

    s.meta.score.opp !==
      lastScoreOpp;


  var restarted =
    prevS &&
    s.meta
      .rallyFrameCount <
    prevS.meta
      .rallyFrameCount;


  if (
    lastScoreSelf < 0 ||
    scoreChanged ||
    restarted
  ) {

    resetRally(
      s
    );
  }
}


/* =========================================================
 * Snapshot memory
 * ========================================================= */

function finish(
  s,
  action
) {
  prevS = {
    tick:
      s.tick,

    side:
      s.side,


    self: {
      x:
        s.self.x,

      y:
        s.self.y,

      state:
        s.self.state,

      frameNumber:
        s.self.frameNumber,

      divingDirection:
        s.self
          .divingDirection
    },


    opp: {
      x:
        s.opp.x,

      y:
        s.opp.y,

      state:
        s.opp.state,

      frameNumber:
        s.opp.frameNumber,

      divingDirection:
        s.opp
          .divingDirection
    },


    ball: {
      x:
        s.ball.x,

      y:
        s.ball.y,

      xVelocity:
        s.ball
          .xVelocity,

      yVelocity:
        s.ball
          .yVelocity,

      isPowerHit:
        s.ball
          .isPowerHit,

      expectedLandingPointX:
        s.ball
          .expectedLandingPointX
    },


    meta: {
      score: {
        self:
          s.meta.score.self,

        opp:
          s.meta.score.opp
      },

      isPlayer2Serve:
        s.meta
          .isPlayer2Serve,

      rallyFrameCount:
        s.meta
          .rallyFrameCount
    },


    config: {
      tickFrameGroupSize:
        s.config
          .tickFrameGroupSize
    }
  };


  lastScoreSelf =
    s.meta.score.self;

  lastScoreOpp =
    s.meta.score.opp;


  return action;
}


/* =========================================================
 * MAIN
 * ========================================================= */

function decide(snapshot) {
  var s =
    snapshot;


  maybeResetRally(
    s
  );


  /*
   * =====================================================
   * 1. 이미 시작한 공격
   * =====================================================
   */
  var locked =
    handleAttackLock(
      s
    );


  if (
    locked
  ) {

    return finish(
      s,
      locked
    );
  }


  /*
   * =====================================================
   * 2. Possession update
   * =====================================================
   */
  updatePossession(
    s
  );


  /*
   * =====================================================
   * 3. 방금 공격한 공
   * =====================================================
   */
  if (
    sentBall
  ) {

    return finish(
      s,

      {
        x:
          moveToward(
            s.self.x,
            stableStandbyX(s),
            7
          ),

        y:
          0,

        hit:
          0
      }
    );
  }


  var currentSim =
    simulateBall(
      s.ball,
      70
    );


  /*
   * =====================================================
   * 4. 이미 한 번 receive
   * =====================================================
   *
   * 다음 touch = attack.
   */
  if (
    mustAttack &&
    onMySide(
      s,
      s.ball.x
    )
  ) {

    var forced =
      chooseAttackPlan(
        s
      );


    if (
      forced
    ) {

      return finish(
        s,

        startAttack(
          s,
          forced,
          'AFTER_RECEIVE'
        )
      );
    }


    /*
     * attack timing을 놓쳐서
     * 두 번째 body trap 직전이면 UP clear.
     */
    var emergency =
      emergencyClearPlan(
        s
      );


    if (
      emergency
    ) {

      return finish(
        s,

        startAttack(
          s,
          emergency,
          'ANTI_TRAP'
        )
      );
    }


    /*
     * 아직 공격 contact가 안 생겼으면
     * 점프하지 않고 공 아래로 위치만 잡음.
     */
    return finish(
      s,

      {
        x:
          moveToward(
            s.self.x,

            clamp(
              s.ball.x,
              myMin(s),
              myMax(s)
            ),

            5
          ),

        y:
          0,

        hit:
          0
      }
    );
  }


  /*
   * =====================================================
   * 5. 공이 우리 쪽으로 들어오는 중
   * =====================================================
   */
  var ballClearlyIncoming =
    onMySide(
      s,
      s.ball.x
    ) ||

    (
      Math.abs(
        s.ball.x -
        NET
      ) < 34 &&

      inbound(
        s,
        s.ball.xVelocity
      )
    );


  if (
    ballClearlyIncoming
  ) {

    /*
     * -------------------------------------
     * ONE-TOUCH COUNTER
     * -------------------------------------
     *
     * SB12.1:
     *
     * KILL 또는
     * 확실한 근거리 FORCED_DIVE일 때만.
     */
    if (
      onMySide(
        s,
        s.ball.x
      )
    ) {

      var oneTouch =
        chooseAttackPlan(
          s
        );


      if (
        shouldTakeOneTouchAttack(
          s,
          oneTouch
        )
      ) {

        return finish(
          s,

          startAttack(
            s,
            oneTouch,
            'ONE_TOUCH'
          )
        );
      }
    }


    /*
     * 나머지는 안정적인 수비.
     *
     * Ground
     * ↓
     * Dive
     * ↓
     * Emergency Jump
     */
    var direct =
      directDefenseAction(
        s,
        currentSim
      );


    return finish(
      s,
      direct.action
    );
  }


  /*
   * =====================================================
   * 6. 상대가 다음 contact를 가질 가능성
   * =====================================================
   *
   * 현재 공 위치에서 공격을 가정하지 않는다.
   *
   * 상대의 실제 미래 contact부터 찾는다.
   */
  var oppContact =
    findOpponentContact(
      s,
      currentSim
    );


  if (
    oppContact
  ) {

    var threats =
      buildOpponentThreats(
        s,
        oppContact
      );


    var threatTarget =
      chooseThreatDefenseTarget(
        s,
        oppContact,
        threats
      );


    if (
      threatTarget != null
    ) {

      maybeLogDefense(
        s,
        oppContact,
        threats,
        threatTarget
      );


      return finish(
        s,

        {
          x:
            moveToward(
              s.self.x,
              threatTarget,
              6
            ),

          y:
            0,

          hit:
            0
        }
      );
    }
  }


  /*
   * =====================================================
   * 7. 안정적인 기본 수비 위치
   * =====================================================
   *
   * 절대 추측 점프하지 않는다.
   */
  defenseMemoryX =
    defenseMemoryX == null
      ? stableStandbyX(s)
      : defenseMemoryX;


  return finish(
    s,

    {
      x:
        moveToward(
          s.self.x,
          stableStandbyX(s),
          7
        ),

      y:
        0,

      hit:
        0
    }
  );
}