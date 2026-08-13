var DEBUG=true;
var prevS=null;
var attackLock=null;
var mustAttack=false;
var sentBall=false;
var receiveArmedUntil=-1;
var jumpCooldownUntil=-1;
var attackHistory=[];
var defenseMemoryX=null;
var lastDefenseLogTick=-999;
var lastScoreSelf=-1;
var lastScoreOpp=-1;

var W=432;
var NET=216;
var HALF=32;
var BALL_R=20;
var PLAYER_GROUND_Y=244;
var BALL_GROUND_Y=252;
var NET_HALF=25;
var NET_TOP=176;
var NET_BOTTOM=192;
var RUN=6;
var DIVE=8;
var CONTROL_DELAY=1;
var ATTACK_HORIZON=13;
var OPP_CONTACT_HORIZON=24;
var REACTION_BUFFER=2;

function log(){
  if(!DEBUG||typeof console==='undefined'){
    return;
  }
  console.log.apply(console,arguments);
}

function clamp(v,lo,hi){
  return Math.max(lo,Math.min(hi,v));
}

function isLeft(s){
  return s.side==='LEFT';
}

function myMin(s){
  return isLeft(s)?HALF:NET+HALF;
}

function myMax(s){
  return isLeft(s)?NET-HALF:W-HALF;
}

function oppMin(s){
  return isLeft(s)?NET+HALF:HALF;
}

function oppMax(s){
  return isLeft(s)?W-HALF:NET-HALF;
}

function onMySide(s,x){
  return isLeft(s)?x<NET:x>NET;
}

function onOppSide(s,x){
  return isLeft(s)?x>NET:x<NET;
}

function inbound(s,vx){
  return isLeft(s)?vx<0:vx>0;
}

function outbound(s,vx){
  return isLeft(s)?vx>0:vx<0;
}

function moveToward(x,target,dead){
  var dz=dead==null?7:dead;

  if(target<x-dz){
    return -1;
  }

  if(target>x+dz){
    return 1;
  }

  return 0;
}

function cloneBall(ball){
  return {
    x:ball.x,
    y:ball.y,
    vx:ball.xVelocity!=null?ball.xVelocity:ball.vx,
    vy:ball.yVelocity!=null?ball.yVelocity:ball.vy
  };
}

function stableStandbyX(s){
  var oppDist=Math.abs(s.opp.x-NET);
  var dist=88+Math.min(34,oppDist*0.22);

  return clamp(
    isLeft(s)?NET-dist:NET+dist,
    myMin(s)+8,
    myMax(s)-8
  );
}

function stepBall(b){
  var ev={
    ground:false,
    wall:false,
    ceiling:false,
    net:false
  };

  var futureX=b.x+b.vx;

  if(futureX<BALL_R||futureX>W){
    b.vx=-b.vx;
    ev.wall=true;
  }

  var futureY=b.y+b.vy;

  if(futureY<0){
    b.vy=1;
    ev.ceiling=true;
  }

  if(Math.abs(b.x-NET)<NET_HALF&&b.y>NET_TOP){
    if(b.y<=NET_BOTTOM){
      if(b.vy>0){
        b.vy=-b.vy;
        ev.net=true;
      }
    }else{
      b.vx=b.x<NET
        ?-Math.abs(b.vx)
        :Math.abs(b.vx);

      ev.net=true;
    }
  }

  futureY=b.y+b.vy;

  if(futureY>BALL_GROUND_Y){
    b.y=BALL_GROUND_Y;
    ev.ground=true;
    return ev;
  }

  b.y=futureY;
  b.x+=b.vx;
  b.vy+=1;

  return ev;
}

function simulateBall(ball,maxFrames){
  var b=cloneBall(ball);
  var path=[];

  for(var f=1;f<=maxFrames;f++){
    var ev=stepBall(b);

    path.push({
      frame:f,
      x:b.x,
      y:b.y,
      vx:b.vx,
      vy:b.vy,
      ground:ev.ground
    });

    if(ev.ground){
      return {
        path:path,
        landed:true,
        landingFrame:f,
        landingX:b.x
      };
    }
  }

  return {
    path:path,
    landed:false,
    landingFrame:maxFrames+1,
    landingX:b.x
  };
}

function simulatePowerFrom(
  s,
  ball,
  xAbs,
  yDir,
  maxFrames
){
  var b=cloneBall(ball);

  var baseVy=Math.max(
    Math.abs(b.vy),
    15
  );

  b.vx=b.x<NET
    ?(xAbs+1)*10
    :-(xAbs+1)*10;

  b.vy=baseVy*yDir*2;

  var path=[];
  var ceiling=false;
  var net=false;

  for(var f=1;f<=maxFrames;f++){
    var ev=stepBall(b);

    if(ev.ceiling){
      ceiling=true;
    }

    if(ev.net){
      net=true;
    }

    path.push({
      frame:f,
      x:b.x,
      y:b.y,
      vx:b.vx,
      vy:b.vy,
      ground:ev.ground
    });

    if(ev.ground){
      return {
        path:path,
        landed:true,
        landingFrame:f,
        landingX:b.x,
        ceiling:ceiling,
        net:net,
        safe:onOppSide(s,b.x)
      };
    }
  }

  return {
    path:path,
    landed:false,
    landingFrame:maxFrames+1,
    landingX:b.x,
    ceiling:ceiling,
    net:net,
    safe:false
  };
}

function jumpYAfter(frames){
  var y=PLAYER_GROUND_Y;
  var vy=-16;

  for(var i=0;i<frames;i++){
    y+=vy;

    if(y<PLAYER_GROUND_Y){
      vy+=1;
    }else{
      y=PLAYER_GROUND_Y;
      break;
    }
  }

  return y;
}

function diveYAfter(frames){
  var y=PLAYER_GROUND_Y;
  var vy=-5;

  for(var i=0;i<frames;i++){
    y+=vy;

    if(y<PLAYER_GROUND_Y){
      vy+=1;
    }else{
      y=PLAYER_GROUND_Y;
      break;
    }
  }

  return y;
}

function estimateAirVy(s,which){
  var p=s[which];

  if(!prevS||!prevS[which]){
    return p.y<150?2:-7;
  }

  var group=Math.max(
    1,
    s.config.tickFrameGroupSize||3
  );

  var dy=p.y-prevS[which].y;

  return clamp(
    Math.round(
      dy/group+
      (group+1)/2
    ),
    -16,
    16
  );
}

function predictExistingAirY(
  s,
  which,
  frames
){
  var y=s[which].y;
  var vy=estimateAirVy(s,which);

  for(var i=0;i<frames;i++){
    y+=vy;

    if(y<PLAYER_GROUND_Y){
      vy+=1;
    }else{
      y=PLAYER_GROUND_Y;
      break;
    }
  }

  return y;
}

function predictedOpponentX(
  s,
  frames
){
  var x=s.opp.x;

  if(!prevS){
    return clamp(
      x,
      oppMin(s),
      oppMax(s)
    );
  }

  var group=Math.max(
    1,
    s.config.tickFrameGroupSize||3
  );

  var vx=clamp(
    (
      s.opp.x-
      prevS.opp.x
    )/group,
    -RUN,
    RUN
  );

  x+=vx*Math.min(frames,12);

  return clamp(
    x,
    oppMin(s),
    oppMax(s)
  );
}

function opponentMotion(s){
  if(!prevS){
    return 0;
  }

  var dx=
    s.opp.x-
    prevS.opp.x;

  if(Math.abs(dx)<2){
    return 0;
  }

  return dx>0?1:-1;
}

function canPlayerTouchPoint(
  s,
  which,
  point,
  frame
){
  var p=s[which];

  var lo=
    which==='self'
      ?myMin(s)
      :oppMin(s);

  var hi=
    which==='self'
      ?myMax(s)
      :oppMax(s);

  var targetX=clamp(
    point.x,
    lo,
    hi
  );

  if(
    Math.abs(
      targetX-p.x
    )>
    RUN*frame+HALF
  ){
    return false;
  }

  if(
    Math.abs(
      point.y-
      PLAYER_GROUND_Y
    )<=HALF
  ){
    return true;
  }

  if(
    p.state===1||
    p.state===2||
    p.state===3
  ){
    return (
      Math.abs(
        point.y-
        predictExistingAirY(
          s,
          which,
          frame
        )
      )<=HALF
    );
  }

  if(p.state!==0){
    return false;
  }

  var maxDelay=Math.min(
    9,
    frame-1
  );

  for(
    var delay=0;
    delay<=maxDelay;
    delay++
  ){
    var airFrames=
      frame-delay;

    if(
      airFrames>0&&
      Math.abs(
        point.y-
        jumpYAfter(
          airFrames
        )
      )<=HALF
    ){
      return true;
    }
  }

  return false;
}

function findOpponentContact(
  s,
  currentPath
){
  var limit=Math.min(
    OPP_CONTACT_HORIZON,
    currentPath.path.length
  );

  for(var i=0;i<limit;i++){
    var p=currentPath.path[i];

    if(!onOppSide(s,p.x)){
      continue;
    }

    if(
      canPlayerTouchPoint(
        s,
        'opp',
        p,
        p.frame
      )
    ){
      return {
        frame:p.frame,
        point:p
      };
    }
  }

  return null;
}

function buildOpponentThreats(
  s,
  contact
){
  if(!contact){
    return [];
  }

  var threats=[];

  var ball={
    x:contact.point.x,
    y:contact.point.y,
    vx:contact.point.vx,
    vy:contact.point.vy
  };

  for(
    var xAbs=0;
    xAbs<=1;
    xAbs++
  ){
    for(
      var yDir=-1;
      yDir<=1;
      yDir++
    ){
      var out=
        simulatePowerFrom(
          s,
          ball,
          xAbs,
          yDir,
          70
        );

      if(
        !out.landed||
        !onMySide(
          s,
          out.landingX
        )
      ){
        continue;
      }

      threats.push({
        xAbs:xAbs,
        yDir:yDir,
        landingX:out.landingX,
        landingFrame:out.landingFrame,
        totalFrame:
          contact.frame+
          out.landingFrame,
        path:out.path
      });
    }
  }

  return threats;
}

function chooseThreatDefenseTarget(
  s,
  contact,
  threats
){
  if(
    !contact||
    threats.length===0
  ){
    return null;
  }

  if(contact.frame>8){
    if(defenseMemoryX==null){
      defenseMemoryX=
        stableStandbyX(s);
    }

    return Math.round(
      defenseMemoryX
    );
  }

  var moveFrames=Math.max(
    1,
    contact.frame-
    CONTROL_DELAY
  );

  var reachableLo=clamp(
    s.self.x-
    RUN*moveFrames,
    myMin(s)+6,
    myMax(s)-6
  );

  var reachableHi=clamp(
    s.self.x+
    RUN*moveFrames,
    myMin(s)+6,
    myMax(s)-6
  );

  var oldTarget=
    defenseMemoryX==null
      ?s.self.x
      :defenseMemoryX;

  var bestX=clamp(
    oldTarget,
    reachableLo,
    reachableHi
  );

  var bestScore=-1e18;

  for(
    var x=myMin(s)+6;
    x<=myMax(s)-6;
    x+=6
  ){
    if(
      x<reachableLo||
      x>reachableHi
    ){
      continue;
    }

    var coverageScore=0;
    var worstMiss=0;

    for(
      var i=0;
      i<threats.length;
      i++
    ){
      var th=threats[i];

      var receiveFrames=
        Math.max(
          0,
          th.landingFrame-
          REACTION_BUFFER
        );

      var runReach=
        RUN*receiveFrames+
        HALF;

      var miss=Math.max(
        0,
        Math.abs(
          th.landingX-x
        )-
        runReach
      );

      var urgency=
        1+
        10/
        Math.max(
          5,
          th.landingFrame
        );

      if(miss<=0){
        coverageScore+=
          1000*urgency;
      }else{
        coverageScore-=
          miss*
          18*
          urgency;
      }

      if(miss>worstMiss){
        worstMiss=miss;
      }
    }

    var switchCost=
      Math.abs(
        x-oldTarget
      )*5;

    var moveCost=
      Math.abs(
        x-s.self.x
      )*1.5;

    var score=
      coverageScore-
      worstMiss*25-
      switchCost-
      moveCost;

    if(score>bestScore){
      bestScore=score;
      bestX=x;
    }
  }

  if(
    Math.abs(
      bestX-oldTarget
    )<12
  ){
    bestX=oldTarget;
  }

  defenseMemoryX=clamp(
    bestX,
    myMin(s)+6,
    myMax(s)-6
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
){
  if(
    !DEBUG||
    target==null
  ){
    return;
  }

  if(
    s.tick-
    lastDefenseLogTick>=15
  ){
    log(
      '[SB12.1 DEF]',
      'tick='+s.tick,
      'oppContact='+contact.frame,
      'threats='+threats.length,
      'target='+Math.round(target)
    );

    lastDefenseLogTick=s.tick;
  }
}

function findGroundReceive(
  s,
  sim
){
  if(s.self.state!==0){
    return null;
  }

  for(
    var i=0;
    i<sim.path.length;
    i++
  ){
    var p=sim.path[i];

    if(!onMySide(s,p.x)){
      continue;
    }

    if(p.vy<=0){
      continue;
    }

    if(
      Math.abs(
        p.y-
        PLAYER_GROUND_Y
      )>HALF
    ){
      continue;
    }

    var active=Math.max(
      0,
      p.frame-
      CONTROL_DELAY
    );

    var targetX=clamp(
      p.x,
      myMin(s),
      myMax(s)
    );

    var need=Math.max(
      0,
      Math.abs(
        targetX-
        s.self.x
      )-
      (HALF-3)
    );

    if(
      need<=
      RUN*active
    ){
      return {
        frame:p.frame,
        targetX:targetX,
        point:p
      };
    }
  }

  return null;
}

function findDiveReceive(
  s,
  sim
){
  if(s.self.state!==0){
    return null;
  }

  for(
    var i=0;
    i<sim.path.length&&
    i<18;
    i++
  ){
    var p=sim.path[i];

    if(!onMySide(s,p.x)){
      continue;
    }

    if(p.vy<=0){
      continue;
    }

    var active=Math.max(
      1,
      p.frame-
      CONTROL_DELAY
    );

    var playerY=
      diveYAfter(
        Math.max(
          0,
          active-1
        )
      );

    var targetX=clamp(
      p.x,
      myMin(s),
      myMax(s)
    );

    var dx=
      targetX-
      s.self.x;

    if(
      Math.abs(
        p.y-playerY
      )>
      HALF+8
    ){
      continue;
    }

    if(Math.abs(dx)<64){
      continue;
    }

    var reach=
      6+
      Math.max(
        0,
        active-1
      )*
      DIVE+
      HALF-
      4;

    if(
      Math.abs(dx)<=
      reach
    ){
      return {
        frame:p.frame,
        targetX:targetX,
        direction:
          dx>0?1:-1,
        point:p
      };
    }
  }

  return null;
}

function findEmergencyJumpSave(
  s,
  sim
){
  if(s.self.state!==0){
    return null;
  }

  for(
    var i=0;
    i<sim.path.length&&
    i<8;
    i++
  ){
    var p=sim.path[i];

    if(!onMySide(s,p.x)){
      continue;
    }

    if(p.vy<=0){
      continue;
    }

    var active=
      p.frame-
      CONTROL_DELAY;

    if(
      active<2||
      active>6
    ){
      continue;
    }

    if(p.y>198){
      continue;
    }

    var horizontalGap=
      Math.abs(
        p.x-
        s.self.x
      );

    if(horizontalGap>72){
      continue;
    }

    var playerY=
      jumpYAfter(active);

    if(
      Math.abs(
        p.y-playerY
      )>
      HALF-2
    ){
      continue;
    }

    if(
      horizontalGap>
      RUN*active+
      HALF-5
    ){
      continue;
    }

    return {
      frame:p.frame,
      targetX:clamp(
        p.x,
        myMin(s),
        myMax(s)
      ),
      point:p
    };
  }

  return null;
}

function armReceiveWatch(
  s,
  frame
){
  var group=Math.max(
    1,
    s.config.tickFrameGroupSize||3
  );

  if(frame<=group+5){
    receiveArmedUntil=
      Math.max(
        receiveArmedUntil,
        s.tick+
        frame+
        group+
        2
      );
  }
}

function nearSelfNowOrPrev(s){
  var now=
    Math.abs(
      s.ball.x-
      s.self.x
    )<=66&&
    Math.abs(
      s.ball.y-
      s.self.y
    )<=82;

  if(now){
    return true;
  }

  if(!prevS){
    return false;
  }

  return (
    Math.abs(
      prevS.ball.x-
      prevS.self.x
    )<=66&&
    Math.abs(
      prevS.ball.y-
      prevS.self.y
    )<=82
  );
}

function detectNormalReceive(s){
  if(
    !prevS||
    sentBall||
    !onMySide(
      s,
      s.ball.x
    )
  ){
    return false;
  }

  var evidence=
    nearSelfNowOrPrev(s)||
    receiveArmedUntil>=
    s.tick;

  if(!evidence){
    return false;
  }

  if(
    s.ball.isPowerHit===true&&
    outbound(
      s,
      s.ball.xVelocity
    )
  ){
    return false;
  }

  var bouncedUp=
    prevS.ball.yVelocity>0&&
    s.ball.yVelocity<-4;

  var dvx=
    Math.abs(
      s.ball.xVelocity-
      prevS.ball.xVelocity
    );

  var dvy=
    Math.abs(
      s.ball.yVelocity-
      prevS.ball.yVelocity
    );

  var powerEnded=
    prevS.ball.isPowerHit===true&&
    s.ball.isPowerHit===false;

  return (
    s.ball.yVelocity<-2&&
    (
      bouncedUp||
      dvx>=7||
      dvy>=10||
      powerEnded
    )
  );
}

function updatePossession(s){
  if(
    sentBall&&
    onOppSide(
      s,
      s.ball.x
    )
  ){
    sentBall=false;
    mustAttack=false;
    receiveArmedUntil=-1;
    return;
  }

  if(sentBall){
    return;
  }

  if(detectNormalReceive(s)){
    if(!mustAttack){
      log(
        '[SB12.1 RECEIVE]',
        'tick='+s.tick,
        'ball='+
        Math.round(s.ball.x)+
        ','+
        Math.round(s.ball.y),
        'v='+
        s.ball.xVelocity+
        ','+
        s.ball.yVelocity
      );
    }

    mustAttack=true;
    receiveArmedUntil=-1;
  }

  if(
    onOppSide(
      s,
      s.ball.x
    )
  ){
    mustAttack=false;
    receiveArmedUntil=-1;
  }
}

function predictAttackContact(
  s,
  xAbs
){
  if(s.self.state!==0){
    return null;
  }

  var b=cloneBall(s.ball);
  var px=s.self.x;
  var py=s.self.y;
  var pvy=0;
  var started=false;

  for(
    var f=1;
    f<=ATTACK_HORIZON;
    f++
  ){
    var ev=stepBall(b);

    if(ev.ground){
      return null;
    }

    if(f>CONTROL_DELAY){
      var xDir=0;

      if(xAbs===1){
        xDir=
          moveToward(
            px,
            b.x,
            3
          );

        if(xDir===0){
          xDir=
            isLeft(s)
              ?1
              :-1;
        }
      }

      px=clamp(
        px+xDir*RUN,
        myMin(s),
        myMax(s)
      );

      if(!started){
        started=true;
        pvy=-16;
      }

      py+=pvy;

      if(py<PLAYER_GROUND_Y){
        pvy+=1;
      }else{
        py=PLAYER_GROUND_Y;
        pvy=0;
      }
    }

    if(
      Math.abs(
        b.x-px
      )<=HALF&&
      Math.abs(
        b.y-py
      )<=HALF
    ){
      return {
        frame:f,
        ball:{
          x:b.x,
          y:b.y,
          vx:b.vx,
          vy:b.vy
        },
        playerX:px,
        playerY:py,
        aligned:
          Math.abs(
            b.x-px
          )<=12
      };
    }
  }

  return null;
}

function shotName(
  xAbs,
  yDir
){
  var speed=
    xAbs===1
      ?'FAST_'
      :'SLOW_';

  if(yDir===1){
    return speed+'DOWN';
  }

  if(yDir===0){
    return speed+'FLAT';
  }

  return speed+'UP';
}

function historyPenalty(name){
  var p=0;

  for(
    var i=0;
    i<attackHistory.length;
    i++
  ){
    if(
      attackHistory[i]===
      name
    ){
      p+=
        (
          attackHistory.length-i
        )*
        90;
    }
  }

  return p;
}

function rememberAttack(name){
  if(!name){
    return;
  }

  attackHistory.push(name);

  while(
    attackHistory.length>4
  ){
    attackHistory.shift();
  }
}

function canOpponentReachAttackPoint(
  s,
  point,
  totalFromNow
){
  var targetX=clamp(
    point.x,
    oppMin(s),
    oppMax(s)
  );

  var oppX=
    predictedOpponentX(
      s,
      Math.min(
        totalFromNow,
        10
      )
    );

  if(
    Math.abs(
      targetX-oppX
    )>
    RUN*
    Math.max(
      0,
      totalFromNow-
      REACTION_BUFFER
    )+
    HALF
  ){
    return false;
  }

  if(
    Math.abs(
      point.y-
      PLAYER_GROUND_Y
    )<=HALF
  ){
    return true;
  }

  if(
    s.opp.state===1||
    s.opp.state===2||
    s.opp.state===3
  ){
    return (
      Math.abs(
        point.y-
        predictExistingAirY(
          s,
          'opp',
          totalFromNow
        )
      )<=HALF
    );
  }

  if(s.opp.state!==0){
    return false;
  }

  var available=
    Math.max(
      1,
      totalFromNow-
      REACTION_BUFFER
    );

  var maxDelay=
    Math.min(
      8,
      available-1
    );

  for(
    var delay=0;
    delay<=maxDelay;
    delay++
  ){
    var airFrames=
      available-delay;

    if(
      airFrames>0&&
      Math.abs(
        point.y-
        jumpYAfter(
          airFrames
        )
      )<=HALF
    ){
      return true;
    }
  }

  return false;
}

function evaluateAttack(
  s,
  contact,
  xAbs,
  yDir
){
  if(!contact){
    return null;
  }

  if(
    xAbs===0&&
    !contact.aligned
  ){
    return null;
  }

  var group=Math.max(
    1,
    s.config.tickFrameGroupSize||3
  );

  var directionReady=
    group+
    CONTROL_DELAY+
    1;

  if(
    yDir!==-1&&
    contact.frame<=
    directionReady
  ){
    return null;
  }

  var out=
    simulatePowerFrom(
      s,
      contact.ball,
      xAbs,
      yDir,
      80
    );

  if(
    !out.landed||
    !out.safe||
    !onOppSide(
      s,
      out.landingX
    )
  ){
    return null;
  }

  var firstIntercept=999;
  var blockRisk=false;

  for(
    var i=0;
    i<out.path.length;
    i++
  ){
    var p=out.path[i];

    if(!onOppSide(s,p.x)){
      continue;
    }

    var total=
      contact.frame+
      p.frame;

    if(
      canOpponentReachAttackPoint(
        s,
        p,
        total
      )
    ){
      if(firstIntercept===999){
        firstIntercept=p.frame;
      }

      if(
        p.frame<=6&&
        Math.abs(
          p.x-NET
        )<=HALF+14&&
        p.y<
        PLAYER_GROUND_Y-8
      ){
        blockRisk=true;
      }
    }
  }

  var oppAtContact=
    predictedOpponentX(
      s,
      contact.frame
    );

  var runFrames=
    Math.max(
      0,
      out.landingFrame-
      REACTION_BUFFER
    );

  var runCapacity=
    RUN*runFrames+
    HALF;

  var diveCapacity=
    DIVE*runFrames+
    HALF;

  var landingDistance=
    Math.abs(
      out.landingX-
      oppAtContact
    );

  var tier;
  var tierName;

  if(firstIntercept===999){
    tier=4;
    tierName='KILL';
  }else if(
    !blockRisk&&
    landingDistance>
    runCapacity&&
    landingDistance<=
    diveCapacity
  ){
    tier=3;
    tierName='FORCED_DIVE';
  }else if(
    !blockRisk&&
    landingDistance>
    runCapacity*0.72
  ){
    tier=2;
    tierName='BAD_POSITION';
  }else{
    tier=1;
    tierName='NORMAL';
  }

  var score=tier*10000;

  if(blockRisk){
    score-=5000;
  }

  score+=landingDistance*7;
  score-=out.landingFrame*18;

  var motion=
    opponentMotion(s);

  if(
    motion>0&&
    out.landingX<
    s.opp.x-8
  ){
    score+=320;
  }

  if(
    motion<0&&
    out.landingX>
    s.opp.x+8
  ){
    score+=320;
  }

  var oppNearNet=
    Math.abs(
      s.opp.x-NET
    )<78;

  var oppBack=
    Math.abs(
      s.opp.x-NET
    )>118;

  var landingNearNet=
    Math.abs(
      out.landingX-NET
    )<78;

  var landingDeep=
    Math.abs(
      out.landingX-NET
    )>125;

  if(
    oppBack&&
    landingNearNet
  ){
    score+=700;
  }

  if(
    oppNearNet&&
    landingDeep
  ){
    score+=650;
  }

  if(
    yDir===1&&
    contact.ball.y<160
  ){
    score+=380;
  }

  if(
    yDir===0&&
    xAbs===1
  ){
    score+=180;
  }

  if(yDir===-1){
    score-=220;
  }

  if(out.ceiling){
    score-=
      blockRisk
        ?40
        :260;
  }

  if(
    blockRisk&&
    yDir===-1
  ){
    score+=700;
  }

  score-=
    historyPenalty(
      shotName(
        xAbs,
        yDir
      )
    );

  return {
    name:shotName(
      xAbs,
      yDir
    ),
    xAbs:xAbs,
    yDir:yDir,
    contact:contact,
    tier:tier,
    tierName:tierName,
    score:score,
    blockRisk:blockRisk,
    firstIntercept:firstIntercept,
    landingX:out.landingX,
    landingFrame:out.landingFrame
  };
}

function chooseAttackPlan(s){
  if(
    s.self.state!==0||
    !onMySide(
      s,
      s.ball.x
    )||
    s.tick<=
    jumpCooldownUntil
  ){
    return null;
  }

  var contacts=[
    predictAttackContact(s,0),
    predictAttackContact(s,1)
  ];

  var best=null;

  for(
    var xAbs=0;
    xAbs<=1;
    xAbs++
  ){
    var contact=
      contacts[xAbs];

    if(!contact){
      continue;
    }

    for(
      var yDir=-1;
      yDir<=1;
      yDir++
    ){
      var candidate=
        evaluateAttack(
          s,
          contact,
          xAbs,
          yDir
        );

      if(!candidate){
        continue;
      }

      if(
        !best||
        candidate.score>
        best.score
      ){
        best=candidate;
      }
    }
  }

  return best;
}

function isMyServe(s){
  return isLeft(s)
    ?!s.meta.isPlayer2Serve
    :s.meta.isPlayer2Serve;
}

function shouldTakeOneTouchAttack(
  s,
  plan
){
  if(!plan){
    return false;
  }

  var serve=
    isMyServe(s)&&
    s.meta.rallyFrameCount<55;

  if(serve){
    return true;
  }

  if(
    !inbound(
      s,
      s.ball.xVelocity
    )
  ){
    return false;
  }

  if(plan.tier>=4){
    return true;
  }

  if(
    plan.tier===3&&
    !plan.blockRisk&&
    plan.contact.frame<=7&&
    Math.abs(
      s.ball.x-NET
    )<82&&
    plan.contact.ball.y<165
  ){
    return true;
  }

  return false;
}

function attackXInput(
  s,
  xAbs
){
  if(xAbs===0){
    return 0;
  }

  var x=moveToward(
    s.self.x,
    s.ball.x,
    3
  );

  if(x!==0){
    return x;
  }

  return isLeft(s)?1:-1;
}

function startAttack(
  s,
  plan,
  reason
){
  attackLock={
    startedTick:s.tick,
    expectedContactTick:
      s.tick+
      plan.contact.frame,
    reason:reason,
    name:plan.name,
    xAbs:plan.xAbs,
    yDir:plan.yDir,
    tierName:plan.tierName,
    sawState2:false,
    sawNear:false
  };

  log(
    '[SB12.1 ATTACK]',
    'tick='+s.tick,
    'reason='+reason,
    'shot='+plan.name,
    'purpose='+plan.tierName,
    'contact='+plan.contact.frame,
    'landing='+
      Math.round(
        plan.landingX
      ),
    'block='+plan.blockRisk
  );

  return {
    x:attackXInput(
      s,
      plan.xAbs
    ),
    y:-1,
    hit:1
  };
}

function attackSucceeded(s){
  if(!attackLock){
    return false;
  }

  if(s.self.state===2){
    attackLock.sawState2=true;
  }

  var near=
    Math.abs(
      s.ball.x-
      s.self.x
    )<=58&&
    Math.abs(
      s.ball.y-
      s.self.y
    )<=72;

  if(near){
    attackLock.sawNear=true;
  }

  if(
    !s.ball.isPowerHit||
    !outbound(
      s,
      s.ball.xVelocity
    )
  ){
    return false;
  }

  return (
    attackLock.sawState2&&
    (
      attackLock.sawNear||
      near
    )
  );
}

function handleAttackLock(s){
  if(!attackLock){
    return null;
  }

  if(s.self.state===2){
    attackLock.sawState2=true;
  }

  if(attackSucceeded(s)){
    log(
      '[SB12.1 POWER]',
      'tick='+s.tick,
      'shot='+attackLock.name,
      'purpose='+attackLock.tierName,
      'v='+
        s.ball.xVelocity+
        ','+
        s.ball.yVelocity
    );

    rememberAttack(
      attackLock.name
    );

    attackLock=null;
    mustAttack=false;
    sentBall=true;
    receiveArmedUntil=-1;

    return null;
  }

  if(
    onOppSide(
      s,
      s.ball.x
    )&&
    outbound(
      s,
      s.ball.xVelocity
    )
  ){
    rememberAttack(
      attackLock.name
    );

    attackLock=null;
    mustAttack=false;
    sentBall=true;
    receiveArmedUntil=-1;

    return null;
  }

  var age=
    s.tick-
    attackLock.startedTick;

  if(
    s.self.state===1||
    s.self.state===2
  ){
    return {
      x:attackXInput(
        s,
        attackLock.xAbs
      ),
      y:attackLock.yDir,
      hit:1
    };
  }

  if(
    s.self.state===0&&
    age<=4
  ){
    return {
      x:attackXInput(
        s,
        attackLock.xAbs
      ),
      y:-1,
      hit:1
    };
  }

  if(
    age>18||
    s.tick>
      attackLock.expectedContactTick+
      7
  ){
    log(
      '[SB12.1 MISS]',
      'tick='+s.tick,
      'shot='+attackLock.name,
      'state='+s.self.state,
      'ball='+
        Math.round(
          s.ball.x
        )+
        ','+
        Math.round(
          s.ball.y
        )
    );

    attackLock=null;

    jumpCooldownUntil=
      s.tick+4;

    if(
      onMySide(
        s,
        s.ball.x
      )
    ){
      mustAttack=true;
    }

    return null;
  }

  return {
    x:attackXInput(
      s,
      attackLock.xAbs
    ),
    y:attackLock.yDir,
    hit:1
  };
}

function emergencyClearPlan(s){
  if(
    !mustAttack||
    s.self.state!==0||
    !onMySide(
      s,
      s.ball.x
    )
  ){
    return null;
  }

  if(
    s.ball.yVelocity<=0||
    Math.abs(
      s.ball.x-
      s.self.x
    )>48||
    Math.abs(
      s.ball.y-
      s.self.y
    )>82
  ){
    return null;
  }

  var contact=
    predictAttackContact(
      s,
      1
    );

  if(!contact){
    return null;
  }

  return evaluateAttack(
    s,
    contact,
    1,
    -1
  );
}

function directDefenseAction(
  s,
  sim
){
  var ground=
    findGroundReceive(
      s,
      sim
    );

  if(ground){
    armReceiveWatch(
      s,
      ground.frame
    );

    return {
      action:{
        x:moveToward(
          s.self.x,
          ground.targetX,
          4
        ),
        y:0,
        hit:0
      },
      mode:'GROUND'
    };
  }

  var dive=
    findDiveReceive(
      s,
      sim
    );

  if(dive){
    armReceiveWatch(
      s,
      dive.frame
    );

    var group=Math.max(
      1,
      s.config.tickFrameGroupSize||3
    );

    if(
      dive.frame<=
      group+2
    ){
      log(
        '[SB12.1 SAVE]',
        'tick='+s.tick,
        'type=DIVE',
        'frame='+dive.frame
      );

      return {
        action:{
          x:dive.direction,
          y:0,
          hit:1
        },
        mode:'DIVE'
      };
    }

    return {
      action:{
        x:moveToward(
          s.self.x,
          dive.targetX,
          4
        ),
        y:0,
        hit:0
      },
      mode:'DIVE_SETUP'
    };
  }

  var jump=
    findEmergencyJumpSave(
      s,
      sim
    );

  if(jump){
    armReceiveWatch(
      s,
      jump.frame
    );

    log(
      '[SB12.1 SAVE]',
      'tick='+s.tick,
      'type=JUMP',
      'frame='+jump.frame
    );

    return {
      action:{
        x:moveToward(
          s.self.x,
          jump.targetX,
          4
        ),
        y:-1,
        hit:0
      },
      mode:'JUMP_SAVE'
    };
  }

  var target=
    stableStandbyX(s);

  if(
    sim.landed&&
    onMySide(
      s,
      sim.landingX
    )
  ){
    target=clamp(
      sim.landingX,
      myMin(s),
      myMax(s)
    );
  }

  return {
    action:{
      x:moveToward(
        s.self.x,
        target,
        6
      ),
      y:0,
      hit:0
    },
    mode:'FALLBACK'
  };
}

function resetRally(s){
  attackLock=null;
  mustAttack=false;
  sentBall=false;
  receiveArmedUntil=-1;
  jumpCooldownUntil=-1;
  defenseMemoryX=null;
  lastDefenseLogTick=-999;

  lastScoreSelf=
    s.meta.score.self;

  lastScoreOpp=
    s.meta.score.opp;
}

function maybeResetRally(s){
  var scoreChanged=
    s.meta.score.self!==
      lastScoreSelf||
    s.meta.score.opp!==
      lastScoreOpp;

  var restarted=
    prevS&&
    s.meta.rallyFrameCount<
      prevS.meta.rallyFrameCount;

  if(
    lastScoreSelf<0||
    scoreChanged||
    restarted
  ){
    resetRally(s);
  }
}

function finish(
  s,
  action
){
  prevS={
    tick:s.tick,
    side:s.side,

    self:{
      x:s.self.x,
      y:s.self.y,
      state:s.self.state,
      frameNumber:
        s.self.frameNumber,
      divingDirection:
        s.self.divingDirection
    },

    opp:{
      x:s.opp.x,
      y:s.opp.y,
      state:s.opp.state,
      frameNumber:
        s.opp.frameNumber,
      divingDirection:
        s.opp.divingDirection
    },

    ball:{
      x:s.ball.x,
      y:s.ball.y,
      xVelocity:
        s.ball.xVelocity,
      yVelocity:
        s.ball.yVelocity,
      isPowerHit:
        s.ball.isPowerHit,
      expectedLandingPointX:
        s.ball.expectedLandingPointX
    },

    meta:{
      score:{
        self:s.meta.score.self,
        opp:s.meta.score.opp
      },
      isPlayer2Serve:
        s.meta.isPlayer2Serve,
      rallyFrameCount:
        s.meta.rallyFrameCount
    },

    config:{
      tickFrameGroupSize:
        s.config.tickFrameGroupSize
    }
  };

  lastScoreSelf=
    s.meta.score.self;

  lastScoreOpp=
    s.meta.score.opp;

  return action;
}

function decide(snapshot){
  var s=snapshot;

  maybeResetRally(s);

  var locked=
    handleAttackLock(s);

  if(locked){
    return finish(
      s,
      locked
    );
  }

  updatePossession(s);

  if(sentBall){
    return finish(
      s,
      {
        x:moveToward(
          s.self.x,
          stableStandbyX(s),
          7
        ),
        y:0,
        hit:0
      }
    );
  }

  var currentSim=
    simulateBall(
      s.ball,
      70
    );

  if(
    mustAttack&&
    onMySide(
      s,
      s.ball.x
    )
  ){
    var forced=
      chooseAttackPlan(s);

    if(forced){
      return finish(
        s,
        startAttack(
          s,
          forced,
          'AFTER_RECEIVE'
        )
      );
    }

    var emergency=
      emergencyClearPlan(s);

    if(emergency){
      return finish(
        s,
        startAttack(
          s,
          emergency,
          'ANTI_TRAP'
        )
      );
    }

    return finish(
      s,
      {
        x:moveToward(
          s.self.x,
          clamp(
            s.ball.x,
            myMin(s),
            myMax(s)
          ),
          5
        ),
        y:0,
        hit:0
      }
    );
  }

  var ballClearlyIncoming=
    onMySide(
      s,
      s.ball.x
    )||
    (
      Math.abs(
        s.ball.x-NET
      )<34&&
      inbound(
        s,
        s.ball.xVelocity
      )
    );

  if(ballClearlyIncoming){
    if(
      onMySide(
        s,
        s.ball.x
      )
    ){
      var oneTouch=
        chooseAttackPlan(s);

      if(
        shouldTakeOneTouchAttack(
          s,
          oneTouch
        )
      ){
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

    var direct=
      directDefenseAction(
        s,
        currentSim
      );

    return finish(
      s,
      direct.action
    );
  }

  var oppContact=
    findOpponentContact(
      s,
      currentSim
    );

  if(oppContact){
    var threats=
      buildOpponentThreats(
        s,
        oppContact
      );

    var threatTarget=
      chooseThreatDefenseTarget(
        s,
        oppContact,
        threats
      );

    if(threatTarget!=null){
      maybeLogDefense(
        s,
        oppContact,
        threats,
        threatTarget
      );

      return finish(
        s,
        {
          x:moveToward(
            s.self.x,
            threatTarget,
            6
          ),
          y:0,
          hit:0
        }
      );
    }
  }

  defenseMemoryX=
    defenseMemoryX==null
      ?stableStandbyX(s)
      :defenseMemoryX;

  return finish(
    s,
    {
      x:moveToward(
        s.self.x,
        stableStandbyX(s),
        7
      ),
      y:0,
      hit:0
    }
  );
}


/* =========================================================
 * SB12.2 SKILL-MINIMAX OVERLAY
 * ========================================================= */

var SB121_BASE_DECIDE=decide;

var sb122PrevOppX=null;
var sb122PrevTick=null;

var sb122CastPendingUntil=-1;

var sb122DefensePlan=null;
var sb122LastPlanKey='';

var sb122ExpectClawHitUntilTick=-1;
var sb122RecoveryMode=false;

var sb122LastClawSeen=null;


function sb122SkillAvailable(s){
  return (
    !!s&&
    !!s.self&&
    !!s.opp&&
    !!s.config&&
    !!s.config.claw&&
    typeof s.self.gauge==='number'
  );
}

function sb122ClawCost(s){
  if(
    !sb122SkillAvailable(s)||
    typeof s.config.claw.cost!==
      'number'
  ){
    return Infinity;
  }

  return s.config.claw.cost;
}

function sb122ClawWarning(s){
  if(
    sb122SkillAvailable(s)&&
    typeof s.config.claw.warningFrames===
      'number'
  ){
    return s.config.claw.warningFrames;
  }

  return 25;
}

function sb122ClawStunFrames(s){
  if(
    sb122SkillAvailable(s)&&
    typeof s.config.claw.stunFrames===
      'number'
  ){
    return s.config.claw.stunFrames;
  }

  return 25;
}

function sb122ClawWidth(s){
  if(
    sb122SkillAvailable(s)&&
    typeof s.config.claw.width===
      'number'
  ){
    return s.config.claw.width;
  }

  return 96;
}

function sb122DangerHalfWidth(s){
  return (
    sb122ClawWidth(s)/2+
    HALF
  );
}

function sb122IsDangerX(
  s,
  claw,
  x
){
  if(!claw){
    return false;
  }

  return (
    Math.abs(
      x-claw.centerX
    )<=
    sb122DangerHalfWidth(s)
  );
}

function sb122ClawSignature(claw){
  if(!claw){
    return 'none';
  }

  return (
    Math.round(
      claw.centerX
    )+
    ':'+
    Math.max(
      0,
      claw.framesUntilStrike
    )
  );
}

function sb122PathFromSimulation(
  sim,
  frameOffset
){
  var out=[];
  var offset=frameOffset||0;

  if(!sim||!sim.path){
    return out;
  }

  for(
    var i=0;
    i<sim.path.length;
    i++
  ){
    var p=sim.path[i];

    out.push({
      frame:
        offset+p.frame,
      x:p.x,
      y:p.y,
      vx:p.vx,
      vy:p.vy,
      ground:!!p.ground
    });
  }

  return out;
}

function sb122PathLandingFrame(path){
  if(
    !path||
    path.length===0
  ){
    return 9999;
  }

  for(
    var i=0;
    i<path.length;
    i++
  ){
    if(path[i].ground){
      return path[i].frame;
    }
  }

  return (
    path[
      path.length-1
    ].frame+
    1
  );
}

function sb122PathCrossesSideBefore(
  s,
  path,
  wantOpponentSide,
  frameLimit
){
  if(!path){
    return false;
  }

  for(
    var i=0;
    i<path.length;
    i++
  ){
    var p=path[i];

    if(p.frame>frameLimit){
      break;
    }

    if(
      wantOpponentSide
        ?onOppSide(s,p.x)
        :onMySide(s,p.x)
    ){
      return true;
    }
  }

  return false;
}

function sb122SideMin(
  s,
  which
){
  return which==='self'
    ?myMin(s)
    :oppMin(s);
}

function sb122SideMax(
  s,
  which
){
  return which==='self'
    ?myMax(s)
    :oppMax(s);
}

function sb122SideContains(
  s,
  which,
  x
){
  return which==='self'
    ?onMySide(s,x)
    :onOppSide(s,x);
}

function sb122UniquePush(
  arr,
  value
){
  if(
    typeof value!=='number'||
    !isFinite(value)
  ){
    return;
  }

  for(
    var i=0;
    i<arr.length;
    i++
  ){
    if(
      Math.abs(
        arr[i]-value
      )<0.5
    ){
      return;
    }
  }

  arr.push(value);
}

function sb122SafePositionsAtStrike(
  s,
  claw,
  which,
  currentX,
  strikeFrames,
  generous
){
  var lo=
    sb122SideMin(
      s,
      which
    );

  var hi=
    sb122SideMax(
      s,
      which
    );

  var danger=
    sb122DangerHalfWidth(s);

  var leftHi=
    claw.centerX-
    danger-
    4;

  var rightLo=
    claw.centerX+
    danger+
    4;

  var candidates=[];

  function addInterval(a,b){
    a=Math.max(a,lo);
    b=Math.min(b,hi);

    if(a>b){
      return;
    }

    sb122UniquePush(
      candidates,
      clamp(
        currentX,
        a,
        b
      )
    );

    sb122UniquePush(
      candidates,
      a
    );

    sb122UniquePush(
      candidates,
      b
    );

    sb122UniquePush(
      candidates,
      (a+b)/2
    );
  }

  addInterval(
    lo,
    leftHi
  );

  addInterval(
    rightLo,
    hi
  );

  var reachable=[];

  var active=Math.max(
    0,
    strikeFrames-
    CONTROL_DELAY
  );

  var maxMove=
    RUN*active+
    (
      generous
        ?8
        :0
    );

  for(
    var i=0;
    i<candidates.length;
    i++
  ){
    var x=candidates[i];

    if(
      Math.abs(
        x-currentX
      )<=maxMove&&
      !sb122IsDangerX(
        s,
        claw,
        x
      )
    ){
      reachable.push(x);
    }
  }

  return reachable;
}

function sb122DangerPositionsAtStrike(
  s,
  claw,
  which,
  currentX,
  strikeFrames,
  generous
){
  var lo=
    sb122SideMin(
      s,
      which
    );

  var hi=
    sb122SideMax(
      s,
      which
    );

  var danger=
    sb122DangerHalfWidth(s);

  var a=Math.max(
    lo,
    claw.centerX-danger
  );

  var b=Math.min(
    hi,
    claw.centerX+danger
  );

  if(a>b){
    return [];
  }

  var raw=[];

  sb122UniquePush(
    raw,
    clamp(
      currentX,
      a,
      b
    )
  );

  sb122UniquePush(raw,a);
  sb122UniquePush(raw,b);

  sb122UniquePush(
    raw,
    (a+b)/2
  );

  for(
    var x=a;
    x<=b;
    x+=16
  ){
    sb122UniquePush(
      raw,
      x
    );
  }

  var reachable=[];

  var active=Math.max(
    0,
    strikeFrames-
    CONTROL_DELAY
  );

  var maxMove=
    RUN*active+
    (
      generous
        ?10
        :0
    );

  for(
    var i=0;
    i<raw.length;
    i++
  ){
    if(
      Math.abs(
        raw[i]-currentX
      )<=maxMove&&
      sb122IsDangerX(
        s,
        claw,
        raw[i]
      )
    ){
      reachable.push(
        raw[i]
      );
    }
  }

  return reachable;
}

function sb122FindSelfReachOnPath(
  s,
  path,
  startX,
  startFrame
){
  if(!path){
    return null;
  }

  for(
    var i=0;
    i<path.length;
    i++
  ){
    var p=path[i];

    if(
      p.frame<=startFrame||
      !onMySide(
        s,
        p.x
      )
    ){
      continue;
    }

    var active=
      p.frame-
      startFrame-
      CONTROL_DELAY;

    if(active<0){
      continue;
    }

    var tx=clamp(
      p.x,
      myMin(s),
      myMax(s)
    );

    var dx=
      Math.abs(
        tx-startX
      );

    if(
      p.vy>0&&
      Math.abs(
        p.y-
        PLAYER_GROUND_Y
      )<=HALF&&
      dx<=
        RUN*active+
        HALF-3
    ){
      return {
        method:'RUN',
        frame:p.frame,
        x:tx,
        margin:
          RUN*active+
          HALF-3-
          dx
      };
    }

    if(
      active>=2&&
      p.vy>0
    ){
      var diveFrames=
        Math.max(
          1,
          active-1
        );

      var diveY=
        diveYAfter(
          diveFrames
        );

      var diveReach=
        6+
        Math.max(
          0,
          active-1
        )*
        DIVE+
        HALF-
        4;

      if(
        dx<=diveReach&&
        Math.abs(
          p.y-diveY
        )<=HALF+8
      ){
        return {
          method:'DIVE',
          frame:p.frame,
          x:tx,
          margin:
            diveReach-dx
        };
      }
    }

    if(
      active>=2&&
      active<=9
    ){
      var jumpY=
        jumpYAfter(active);

      if(
        dx<=
          RUN*active+
          HALF-4&&
        Math.abs(
          p.y-jumpY
        )<=HALF-1
      ){
        return {
          method:'JUMP',
          frame:p.frame,
          x:tx,
          margin:
            RUN*active+
            HALF-4-
            dx
        };
      }
    }
  }

  return null;
}

function sb122OpponentCanReachPathFrom(
  s,
  path,
  startX,
  startFrame
){
  if(!path){
    return false;
  }

  for(
    var i=0;
    i<path.length;
    i++
  ){
    var p=path[i];

    if(
      p.frame<=startFrame||
      !onOppSide(
        s,
        p.x
      )
    ){
      continue;
    }

    var active=
      Math.max(
        0,
        p.frame-
        startFrame
      );

    var tx=clamp(
      p.x,
      oppMin(s),
      oppMax(s)
    );

    var dx=
      Math.abs(
        tx-startX
      );

    if(
      Math.abs(
        p.y-
        PLAYER_GROUND_Y
      )<=HALF+3&&
      dx<=
        RUN*active+
        HALF+8
    ){
      return true;
    }

    if(
      p.vy>0&&
      active>=1&&
      dx<=
        DIVE*active+
        HALF+12
    ){
      return true;
    }

    if(active>=1){
      var maxDelay=
        Math.min(
          10,
          active-1
        );

      for(
        var delay=0;
        delay<=maxDelay;
        delay++
      ){
        var airFrames=
          active-delay;

        if(airFrames<=0){
          continue;
        }

        if(
          dx<=
            RUN*active+
            HALF+8&&
          Math.abs(
            p.y-
            jumpYAfter(
              airFrames
            )
          )<=HALF+6
        ){
          return true;
        }
      }
    }
  }

  return false;
}

function sb122OpponentCanTouchBefore(
  s,
  path,
  frameLimit
){
  if(!path){
    return false;
  }

  for(
    var i=0;
    i<path.length;
    i++
  ){
    var p=path[i];

    if(p.frame>=frameLimit){
      break;
    }

    if(!onOppSide(s,p.x)){
      continue;
    }

    if(
      canPlayerTouchPoint(
        s,
        'opp',
        p,
        p.frame
      )
    ){
      return true;
    }

    if(
      sb122OpponentCanReachPathFrom(
        s,
        [p],
        s.opp.x,
        0
      )
    ){
      return true;
    }
  }

  return false;
}

function sb122NormalBounceBall(
  point,
  playerX
){
  var dx=
    point.x-
    playerX;

  var vx;

  if(dx<0){
    vx=-(
      (
        Math.abs(dx)/3
      )|0
    );
  }else if(dx>0){
    vx=(
      Math.abs(dx)/3
    )|0;
  }else{
    vx=1;
  }

  if(vx===0){
    vx=dx<=0?-1:1;
  }

  return {
    x:point.x,
    y:point.y,
    vx:vx,
    vy:
      -Math.max(
        Math.abs(
          point.vy
        ),
        15
      )
  };
}

function sb122SimulateBallObject(
  ballObject,
  maxFrames,
  frameOffset
){
  var b={
    x:ballObject.x,
    y:ballObject.y,
    vx:ballObject.vx,
    vy:ballObject.vy
  };

  var path=[];
  var offset=frameOffset||0;

  for(
    var f=1;
    f<=maxFrames;
    f++
  ){
    var ev=stepBall(b);

    path.push({
      frame:offset+f,
      x:b.x,
      y:b.y,
      vx:b.vx,
      vy:b.vy,
      ground:!!ev.ground
    });

    if(ev.ground){
      break;
    }
  }

  return path;
}

function sb122FindBufferSurvival(
  s,
  claw
){
  if(
    !claw||
    s.self.state!==0
  ){
    return null;
  }

  var strike=
    claw.framesUntilStrike;

  if(
    typeof strike!=='number'||
    strike<=2
  ){
    return null;
  }

  var sim=
    simulateBall(
      s.ball,
      Math.min(
        50,
        strike+30
      )
    );

  if(!sim||!sim.path){
    return null;
  }

  var best=null;

  for(
    var i=0;
    i<sim.path.length;
    i++
  ){
    var p=sim.path[i];

    if(
      p.frame>=strike||
      !onMySide(s,p.x)||
      p.vy<=0||
      Math.abs(
        p.y-
        PLAYER_GROUND_Y
      )>HALF
    ){
      continue;
    }

    var active=Math.max(
      0,
      p.frame-
      CONTROL_DELAY
    );

    var offsets=[
      -28,
      -20,
      -12,
      12,
      20,
      28
    ];

    for(
      var oi=0;
      oi<offsets.length;
      oi++
    ){
      var playerX=clamp(
        p.x+
        offsets[oi],
        myMin(s),
        myMax(s)
      );

      if(
        Math.abs(
          p.x-playerX
        )>HALF-2
      ){
        continue;
      }

      if(
        Math.abs(
          playerX-
          s.self.x
        )>
        RUN*active+2
      ){
        continue;
      }

      var bounced=
        sb122NormalBounceBall(
          p,
          playerX
        );

      var after=
        sb122SimulateBallObject(
          bounced,
          70,
          p.frame
        );

      var sentBeforeStrike=
        sb122PathCrossesSideBefore(
          s,
          after,
          true,
          strike
        );

      if(sentBeforeStrike){
        var directCandidate={
          type:'BUFFER_SEND',
          firstTouchFrame:p.frame,
          firstTouchX:playerX,
          strikeFrame:strike,
          second:null,
          margin:
            1000-p.frame
        };

        if(
          !best||
          directCandidate.margin>
            best.margin
        ){
          best=directCandidate;
        }

        continue;
      }

      if(
        !sb122IsDangerX(
          s,
          claw,
          playerX
        )
      ){
        continue;
      }

      var recoverFrame=
        strike+
        sb122ClawStunFrames(s);

      var second=
        sb122FindSelfReachOnPath(
          s,
          after,
          playerX,
          recoverFrame
        );

      if(!second){
        continue;
      }

      var landingFrame=
        sb122PathLandingFrame(
          after
        );

      var candidate={
        type:'BUFFER_TAKE',
        firstTouchFrame:p.frame,
        firstTouchX:playerX,
        strikeFrame:strike,
        recoverFrame:recoverFrame,
        second:second,
        margin:
          landingFrame-
          second.frame+
          Math.max(
            0,
            second.margin
          )
      };

      if(
        !best||
        candidate.margin>
          best.margin
      ){
        best=candidate;
      }
    }
  }

  return best;
}

function sb122BuildDefenseThreatPaths(s){
  var current=
    simulateBall(
      s.ball,
      70
    );

  if(!current||!current.path){
    return [];
  }

  var currentPath=
    sb122PathFromSimulation(
      current,
      0
    );

  if(
    onMySide(
      s,
      s.ball.x
    )||
    (
      Math.abs(
        s.ball.x-NET
      )<36&&
      inbound(
        s,
        s.ball.xVelocity
      )
    )
  ){
    return [currentPath];
  }

  var contact=
    findOpponentContact(
      s,
      current
    );

  if(!contact){
    return [currentPath];
  }

  var threats=
    buildOpponentThreats(
      s,
      contact
    );

  if(
    !threats||
    threats.length===0
  ){
    return [currentPath];
  }

  var paths=[];

  for(
    var i=0;
    i<threats.length;
    i++
  ){
    var th=threats[i];
    var path=[];

    for(
      var j=0;
      j<th.path.length;
      j++
    ){
      var p=th.path[j];

      path.push({
        frame:
          contact.frame+
          p.frame,
        x:p.x,
        y:p.y,
        vx:p.vx,
        vy:p.vy,
        ground:!!p.ground
      });
    }

    paths.push(path);
  }

  return paths;
}

function sb122CoverageFromPosition(
  s,
  paths,
  startX,
  startFrame
){
  var covered=0;
  var minMargin=9999;
  var bestReceives=[];

  for(
    var i=0;
    i<paths.length;
    i++
  ){
    var receive=
      sb122FindSelfReachOnPath(
        s,
        paths[i],
        startX,
        startFrame
      );

    if(receive){
      covered++;
      bestReceives.push(
        receive
      );

      minMargin=Math.min(
        minMargin,
        receive.margin
      );
    }else{
      bestReceives.push(
        null
      );

      minMargin=-9999;
    }
  }

  return {
    covered:covered,
    total:paths.length,
    full:
      paths.length>0&&
      covered===paths.length,
    minMargin:minMargin,
    receives:bestReceives
  };
}

function sb122PlanDefense(
  s,
  baseAction
){
  if(
    !sb122SkillAvailable(s)||
    !s.opp.claw
  ){
    return null;
  }

  var claw=s.opp.claw;

  var strike=
    claw.framesUntilStrike;

  if(
    typeof strike!=='number'||
    strike<=0
  ){
    return null;
  }

  if(
    attackLock&&
    typeof attackLock.expectedContactTick===
      'number'
  ){
    var attackIn=
      attackLock.expectedContactTick-
      s.tick;

    if(
      attackIn>0&&
      attackIn<=strike+1
    ){
      return {
        type:'SEND_BEFORE_CLAW',
        action:baseAction,
        coverage:999,
        total:999,
        full:true,
        margin:
          strike-attackIn
      };
    }
  }

  if(
    outbound(
      s,
      s.ball.xVelocity
    )
  ){
    var outboundSim=
      simulateBall(
        s.ball,
        Math.max(
          8,
          strike+2
        )
      );

    var outboundPath=
      sb122PathFromSimulation(
        outboundSim,
        0
      );

    if(
      sb122PathCrossesSideBefore(
        s,
        outboundPath,
        true,
        strike
      )
    ){
      return {
        type:'BALL_ALREADY_SENT',
        action:baseAction,
        coverage:999,
        total:999,
        full:true,
        margin:999
      };
    }
  }

  var paths=
    sb122BuildDefenseThreatPaths(s);

  if(
    !paths||
    paths.length===0
  ){
    return null;
  }

  var candidates=[];

  if(
    onMySide(
      s,
      s.ball.x
    )||
    (
      Math.abs(
        s.ball.x-NET
      )<36&&
      inbound(
        s,
        s.ball.xVelocity
      )
    )
  ){
    var buffer=
      sb122FindBufferSurvival(
        s,
        claw
      );

    if(buffer){
      candidates.push({
        type:buffer.type,
        targetX:
          buffer.firstTouchX,
        firstTouchFrame:
          buffer.firstTouchFrame,
        second:buffer.second,
        coverage:1,
        total:1,
        full:true,
        margin:buffer.margin,
        strikeFrame:strike
      });
    }
  }

  var safeXs=
    sb122SafePositionsAtStrike(
      s,
      claw,
      'self',
      s.self.x,
      strike,
      false
    );

  for(
    var si=0;
    si<safeXs.length;
    si++
  ){
    var safeX=safeXs[si];

    var safeCoverage=
      sb122CoverageFromPosition(
        s,
        paths,
        safeX,
        strike
      );

    candidates.push({
      type:'DODGE_RECEIVE',
      targetX:safeX,
      coverage:
        safeCoverage.covered,
      total:
        safeCoverage.total,
      full:
        safeCoverage.full,
      margin:
        safeCoverage.minMargin,
      strikeFrame:strike
    });
  }

  if(
    sb122IsDangerX(
      s,
      claw,
      s.self.x
    )
  ){
    var recoverFrame=
      strike+
      sb122ClawStunFrames(s);

    var takeCoverage=
      sb122CoverageFromPosition(
        s,
        paths,
        s.self.x,
        recoverFrame
      );

    candidates.push({
      type:'TAKE_CLAW',
      targetX:s.self.x,
      coverage:
        takeCoverage.covered,
      total:
        takeCoverage.total,
      full:
        takeCoverage.full,
      margin:
        takeCoverage.minMargin,
      recoverFrame:recoverFrame,
      strikeFrame:strike
    });
  }

  if(candidates.length===0){
    return null;
  }

  var preference={
    'SEND_BEFORE_CLAW':5,
    'BALL_ALREADY_SENT':5,
    'BUFFER_SEND':4,
    'BUFFER_TAKE':4,
    'TAKE_CLAW':3,
    'DODGE_RECEIVE':2,
    'PURE_DODGE':1
  };

  var best=null;

  for(
    var ci=0;
    ci<candidates.length;
    ci++
  ){
    var c=candidates[ci];

    if(!best){
      best=c;
      continue;
    }

    if(
      Number(c.full)>
      Number(best.full)
    ){
      best=c;
      continue;
    }

    if(
      Number(c.full)<
      Number(best.full)
    ){
      continue;
    }

    if(c.coverage>best.coverage){
      best=c;
      continue;
    }

    if(c.coverage<best.coverage){
      continue;
    }

    if(
      c.margin>
      best.margin+4
    ){
      best=c;
      continue;
    }

    if(
      Math.abs(
        c.margin-
        best.margin
      )<=4&&
      (
        preference[c.type]||0
      )>
      (
        preference[best.type]||0
      )
    ){
      best=c;
    }
  }

  if(
    best&&
    !best.full&&
    best.coverage<=0
  ){
    if(safeXs.length>0){
      var nearestSafe=
        safeXs[0];

      for(
        var ni=1;
        ni<safeXs.length;
        ni++
      ){
        if(
          Math.abs(
            safeXs[ni]-
            s.self.x
          )<
          Math.abs(
            nearestSafe-
            s.self.x
          )
        ){
          nearestSafe=
            safeXs[ni];
        }
      }

      return {
        type:'PURE_DODGE',
        targetX:nearestSafe,
        coverage:0,
        total:paths.length,
        full:false,
        margin:-9999,
        strikeFrame:strike
      };
    }
  }

  return best;
}

function sb122LogPlan(
  s,
  plan
){
  if(!plan){
    return;
  }

  var key=
    plan.type+
    ':'+
    Math.round(
      plan.targetX==null
        ?s.self.x
        :plan.targetX
    )+
    ':'+
    plan.coverage+
    '/'+
    plan.total;

  if(key===sb122LastPlanKey){
    return;
  }

  sb122LastPlanKey=key;

  log(
    '[SB12.2 PLAN]',
    'tick='+s.tick,
    'type='+plan.type,
    'cover='+
      plan.coverage+
      '/'+
      plan.total,
    'full='+!!plan.full,
    'margin='+
      Math.round(
        plan.margin==null
          ?0
          :plan.margin
      ),
    'target='+
      Math.round(
        plan.targetX==null
          ?s.self.x
          :plan.targetX
      )
  );
}

function sb122ArmIntentionalTake(
  s,
  strikeFrames
){
  sb122ExpectClawHitUntilTick=
    Math.max(
      sb122ExpectClawHitUntilTick,
      s.tick+
      strikeFrames+
      8
    );
}

function sb122ApplyDefensePlan(
  s,
  baseAction,
  plan
){
  if(!plan){
    return baseAction;
  }

  sb122DefensePlan=plan;

  sb122LogPlan(
    s,
    plan
  );

  if(
    plan.type==='SEND_BEFORE_CLAW'||
    plan.type==='BALL_ALREADY_SENT'
  ){
    return baseAction;
  }

  if(
    plan.type==='BUFFER_SEND'||
    plan.type==='BUFFER_TAKE'
  ){
    if(
      plan.type===
      'BUFFER_TAKE'
    ){
      sb122ArmIntentionalTake(
        s,
        plan.strikeFrame
      );
    }

    log(
      '[SB12.2 BUFFER]',
      'tick='+s.tick,
      'type='+plan.type,
      'touchIn='+
        plan.firstTouchFrame,
      'x='+
        Math.round(
          plan.targetX
        ),
      'next='+
        (
          plan.second
            ?plan.second.method+
              '@'+
              plan.second.frame
            :'SEND'
        )
    );

    return {
      x:moveToward(
        s.self.x,
        plan.targetX,
        2
      ),
      y:0,
      hit:0
    };
  }

  if(plan.type==='TAKE_CLAW'){
    sb122ArmIntentionalTake(
      s,
      plan.strikeFrame
    );

    log(
      '[SB12.2 TAKE]',
      'tick='+s.tick,
      'strikeIn='+
        plan.strikeFrame,
      'recoverAt='+
        plan.recoverFrame,
      'cover='+
        plan.coverage+
        '/'+
        plan.total
    );

    return {
      x:moveToward(
        s.self.x,
        plan.targetX,
        2
      ),
      y:baseAction.y,
      hit:baseAction.hit
    };
  }

  if(
    plan.type==='DODGE_RECEIVE'||
    plan.type==='PURE_DODGE'
  ){
    log(
      '[SB12.2 DODGE]',
      'tick='+s.tick,
      'type='+plan.type,
      'target='+
        Math.round(
          plan.targetX
        ),
      'strikeIn='+
        plan.strikeFrame,
      'cover='+
        plan.coverage+
        '/'+
        plan.total
    );

    return {
      x:moveToward(
        s.self.x,
        plan.targetX,
        2
      ),
      y:baseAction.y,
      hit:baseAction.hit
    };
  }

  return baseAction;
}

function sb122PreBaseRecovery(s){
  if(
    s.self.state===4&&
    (
      sb122RecoveryMode||
      s.tick<=
        sb122ExpectClawHitUntilTick||
      (
        s.opp.claw&&
        s.opp.claw.framesUntilStrike===
          0
      )
    )
  ){
    if(!sb122RecoveryMode){
      log(
        '[SB12.2 RECOVER]',
        'tick='+s.tick,
        'lying='+
          s.self.lyingDownDurationLeft
      );
    }

    sb122RecoveryMode=true;

    attackLock=null;
    mustAttack=false;

    if(
      onMySide(
        s,
        s.ball.x
      )
    ){
      sentBall=false;
    }

    receiveArmedUntil=-1;
  }

  if(
    sb122RecoveryMode&&
    s.self.state===0&&
    onMySide(
      s,
      s.ball.x
    )
  ){
    attackLock=null;
    mustAttack=false;
    sentBall=false;
  }

  if(
    sb122RecoveryMode&&
    onOppSide(
      s,
      s.ball.x
    )&&
    outbound(
      s,
      s.ball.xVelocity
    )
  ){
    sb122RecoveryMode=false;
  }
}

function sb122PostBaseRecovery(s){
  if(
    sb122RecoveryMode&&
    s.self.state!==4&&
    mustAttack
  ){
    log(
      '[SB12.2 RESCUE]',
      'tick='+s.tick,
      'next=ATTACK'
    );

    sb122RecoveryMode=false;
  }
}
/* =========================================================
 * SB12.3 STRATEGIC SKILL MANAGEMENT
 *
 * FORCED_KILL이 없더라도:
 *
 * 1. Gauge overflow 방지
 * 2. Match emergency
 * 3. Match closeout
 * 4. High-value pressure
 *
 * 를 고려해서 Claw 사용.
 * ========================================================= */

/*
 * 현재 develop-skill은 15점 승리.
 *
 * 현재 bot snapshot에는 winningScore가 없으므로 fallback.
 * 나중에 meta.winningScore가 추가되면 자동 사용.
 */
var SB123_FALLBACK_WIN_SCORE = 15;


/* =========================================================
 * Match context
 * ========================================================= */

function sb123WinningScore(s) {
  if (
    s.meta &&
    typeof s.meta.winningScore === 'number'
  ) {
    return s.meta.winningScore;
  }

  return SB123_FALLBACK_WIN_SCORE;
}


function sb123GaugeMax(s) {
  if (
    s.config &&
    s.config.gauge &&
    typeof s.config.gauge.max === 'number'
  ) {
    return s.config.gauge.max;
  }

  return 100;
}


function sb123GaugeOnReceive(s) {
  if (
    s.config &&
    s.config.gauge &&
    typeof s.config.gauge.onReceive === 'number'
  ) {
    return s.config.gauge.onReceive;
  }

  return 10;
}


/*
 * 경기 전체 관점에서
 * "지금 스킬을 얼마나 써야 하는가?"
 *
 * urgency:
 *
 * 100 = 거의 무조건 써야 함
 * 80+ = 꽤 적극적으로
 * 60+ = 좋은 pressure일 때
 * <60 = FORCED_KILL 아니면 보존
 */
function sb123StrategicUrgency(s) {
  var win =
    sb123WinningScore(s);

  var selfScore =
    s.meta.score.self;

  var oppScore =
    s.meta.score.opp;

  var selfNeed =
    Math.max(
      0,
      win - selfScore
    );

  var oppNeed =
    Math.max(
      0,
      win - oppScore
    );

  var gap =
    selfScore -
    oppScore;

  var gauge =
    s.self.gauge;

  var gaugeMax =
    sb123GaugeMax(s);

  var receiveGain =
    Math.max(
      1,
      sb123GaugeOnReceive(s)
    );


  var urgency = 0;
  var reason = 'CONSERVE';


  /*
   * =====================================================
   * 1. 상대 Match Point
   * =====================================================
   *
   * 한 점 더 내주면 게임 끝.
   * Gauge를 들고 죽는 게 가장 나쁨.
   */
  if (
    oppNeed <= 1
  ) {
    urgency = 100;
    reason = 'OPP_MATCH_POINT';
  }


  /*
   * =====================================================
   * 2. 내 Match Point
   * =====================================================
   *
   * 한 점만 따면 게임을 끝낼 수 있음.
   */
  if (
    selfNeed <= 1 &&
    urgency < 95
  ) {
    urgency = 95;
    reason = 'MY_MATCH_POINT';
  }


  /*
   * =====================================================
   * 3. 상대가 승리까지 2점
   * =====================================================
   */
  if (
    oppNeed <= 2 &&
    urgency < 90
  ) {
    urgency = 90;
    reason = 'MATCH_DANGER';
  }


  /*
   * =====================================================
   * 4. Gauge가 완전히 찼음
   * =====================================================
   *
   * 다음 +10 receive는 그대로 증발할 수 있음.
   */
  if (
    gauge >= gaugeMax &&
    urgency < 92
  ) {
    urgency = 92;
    reason = 'GAUGE_FULL';
  }


  /*
   * =====================================================
   * 5. Gauge가 곧 cap
   * =====================================================
   *
   * 예:
   * 90 / 100 상태.
   *
   * 다음 clean receive 후 100.
   * 그 이후 gain부터 낭비될 가능성이 생김.
   */
  if (
    gauge >=
      gaugeMax -
      receiveGain &&
    urgency < 82
  ) {
    urgency = 82;
    reason = 'GAUGE_NEAR_CAP';
  }


  /*
   * =====================================================
   * 6. 후반 + 크게 뒤짐
   * =====================================================
   */
  if (
    oppScore >=
      win - 5 &&
    gap <= -4 &&
    urgency < 80
  ) {
    urgency = 80;
    reason = 'LATE_TRAILING';
  }


  /*
   * =====================================================
   * 7. 후반 접전
   * =====================================================
   */
  if (
    selfScore >=
      win - 3 &&
    oppScore >=
      win - 3 &&
    urgency < 72
  ) {
    urgency = 72;
    reason = 'LATE_CLOSE_GAME';
  }


  /*
   * =====================================================
   * 8. 상대도 Claw 사용 가능
   * =====================================================
   *
   * 이것 하나만으로 스킬을 쓰진 않지만
   * 이미 어느 정도 긴급한 상황이면 조금 올림.
   */
  if (
    typeof s.opp.gauge === 'number' &&
    s.opp.gauge >=
      sb122ClawCost(s) &&
    urgency >= 60
  ) {
    urgency += 4;
  }


  /*
   * =====================================================
   * 9. 지나치게 긴 rally
   * =====================================================
   *
   * 양쪽이 완벽 수비만 반복하는 상황에서는
   * 자원을 들고 계속 기다릴 필요가 줄어든다.
   */
  if (
    s.meta.rallyFrameCount >= 180 &&
    urgency < 65
  ) {
    urgency = 65;
    reason = 'LONG_RALLY';
  }


  return {
    urgency:
      Math.min(
        100,
        urgency
      ),

    reason:
      reason,

    winScore:
      win,

    selfNeed:
      selfNeed,

    oppNeed:
      oppNeed,

    gap:
      gap
  };
}


/* =========================================================
 * Find opponent's likely first receive point
 * ========================================================= */

function sb123FirstOpponentReceive(
  s,
  attack
) {
  if (
    !attack ||
    !attack.path
  ) {
    return null;
  }


  for (
    var i = 0;
    i < attack.path.length;
    i++
  ) {
    var p =
      attack.path[i];


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
      ) ||
      sb122OpponentCanReachPathFrom(
        s,
        [p],
        s.opp.x,
        0
      )
    ) {
      return p;
    }
  }


  return null;
}


/* =========================================================
 * Best non-guaranteed pressure Claw
 * ========================================================= */

function sb123FindBestPressureCast(
  s,
  attack
) {
  if (
    !attack ||
    !attack.path
  ) {
    return null;
  }


  var warning =
    sb122ClawWarning(s);


  /*
   * 공이 Claw strike보다 너무 먼저 끝나는 trajectory면
   * 이 Claw와 현재 공격을 연계한다고 보기 어렵다.
   */
  if (
    typeof attack.landingFrame === 'number' &&
    attack.landingFrame <= warning - 2
  ) {
    return null;
  }


  var centers =
    sb122OffensiveClawCenters(
      s,
      attack
    );


  var firstReceive =
    sb123FirstOpponentReceive(
      s,
      attack
    );


  /*
   * 상대가 Claw보다 너무 일찍 공을 처리할 수 있으면
   * 현재 trajectory는 곧 깨진다.
   *
   * 이런 경우에는 이 공격을 기준으로
   * pressure Claw를 쓰지 않는다.
   */
  if (
    firstReceive &&
    firstReceive.frame <
      warning - 8
  ) {
    return null;
  }


  if (
    firstReceive
  ) {
    sb122UniquePush(
      centers,
      sb123ClampOffensiveClawX(
        s,
        firstReceive.x
      )
    );


    sb122UniquePush(
      centers,
      sb123ClampOffensiveClawX(
        s,
        firstReceive.x - 36
      )
    );


    sb122UniquePush(
      centers,
      sb123ClampOffensiveClawX(
        s,
        firstReceive.x + 36
      )
    );
  }


  var best = null;


  for (
    var i = 0;
    i < centers.length;
    i++
  ) {

    var center =
      sb123ClampOffensiveClawX(
        s,
        centers[i]
      );


    var result =
      sb122EvaluateOffensiveClaw(
        s,
        attack,
        center
      );


    /*
     * Forced kill은 기존 forced-kill planner 담당.
     */
    if (
      result.forcedKill
    ) {
      continue;
    }


    /*
     * =====================================================
     * 중요:
     *
     * 상대가 Claw strike 전에 이미 공을 처리해서
     * 살아남을 수 있다면 이것을
     * pressureLevel 3으로 취급하면 안 된다.
     * =====================================================
     */
    if (
      result.reason ===
        'PRE_STRIKE_SURVIVAL'
    ) {
      continue;
    }


    var routes =
      typeof result.routes === 'number'
        ? result.routes
        : 99;


    /*
     * 생존 route가 너무 많으면
     * 스킬을 쓸 이유가 없음.
     */
    if (
      routes > 2
    ) {
      continue;
    }


    var pressureLevel;


    if (
      routes <= 1
    ) {
      pressureLevel = 3;

    } else {
      pressureLevel = 2;
    }


    var geometryScore = 0;


    /*
     * 상대 예상 receive 위치와
     * Claw 중심이 가까울수록 좋음.
     */
    if (
      firstReceive
    ) {

      var receiveDistance =
        Math.abs(
          center -
          firstReceive.x
        );


      geometryScore +=
        Math.max(
          0,
          120 -
          receiveDistance
        );


      /*
       * Claw strike와 receive timing이
       * 가까울수록 높은 점수.
       */
      var timingGap =
        Math.abs(
          firstReceive.frame -
          warning
        );


      geometryScore +=
        Math.max(
          0,
          120 -
          timingGap * 14
        );
    }


    /*
     * 상대 현재 위치 역시 약하게 고려.
     */
    geometryScore +=
      Math.max(
        0,
        60 -
        Math.abs(
          center -
          s.opp.x
        )
      ) * 0.25;


    var score =
      pressureLevel * 10000 -
      routes * 1500 +
      geometryScore;


    var candidate = {
      x:
        center,

      score:
        score,

      pressureLevel:
        pressureLevel,

      routes:
        routes,

      attack:
        attack,

      source:
        attack.source,

      landingFrame:
        attack.landingFrame,

      landingX:
        attack.landingX,

      firstReceiveFrame:
        firstReceive
          ? firstReceive.frame
          : null,

      result:
        result
    };


    if (
      !best ||
      candidate.score >
        best.score
    ) {
      best =
        candidate;
    }
  }


  return best;
}


function sb123BlindPressureCast(s) {
  var warning =
    sb122ClawWarning(s);


  var predictedX =
    predictedOpponentX(
      s,
      warning
    );


  var target =
    predictedX;


  /*
   * 현재 공이 상대 코트에 떨어질 trajectory면
   * 상대의 receive zone을 우선 조준.
   */
  var sim =
    simulateBall(
      s.ball,
      Math.max(
        45,
        warning + 15
      )
    );


  if (
    sim.landed &&
    onOppSide(
      s,
      sim.landingX
    )
  ) {
    target =
      clamp(
        sim.landingX,
        oppMin(s),
        oppMax(s)
      );
  }


  return {
    x:
      sb123ClampOffensiveClawX(
        s,
        target
      ),

    score:
      0,

    pressureLevel:
      1,

    routes:
      99,

    source:
      'STRATEGIC_PRESSURE',

    landingFrame:
      sim.landingFrame,

    landingX:
      sim.landingX
  };
}


/* =========================================================
 * Strategic skill selector
 * ========================================================= */

function sb123FindFullGaugeReleaseCast(s) {
  var warning =
    sb122ClawWarning(s);


  var bounds =
    sb123OffensiveClawBounds(
      s
    );


  /*
   * 상대 court 중앙.
   *
   * LEFT  -> 324 근처
   * RIGHT -> 108 근처
   *
   * 현재 Claw + player hitbox geometry 기준으로
   * 상대 legal player-center range 전체를 덮는 위치.
   */
  var center =
    (
      bounds.min +
      bounds.max
    ) / 2;


  center =
    sb123ClampOffensiveClawX(
      s,
      center
    );


  var best = null;


  /*
   * =====================================================
   * A. 지금 공격을 준비 중인 경우
   * =====================================================
   *
   * 현재 attackLock의 horizontal geometry는 유지하고,
   * UP / 현재 방향을 비교한다.
   *
   * 특히 UP은 체공시간을 늘려
   * 25-frame Claw warning과 공격 trajectory를
   * 같이 묶기 위한 resource-release용 선택지.
   */
  if (
    attackLock &&
    typeof attackLock.expectedContactTick ===
      'number'
  ) {

    var dirs = [
      -1,
      attackLock.yDir
    ];


    var seen = {};


    for (
      var i = 0;
      i < dirs.length;
      i++
    ) {

      var yDir =
        dirs[i];


      if (
        seen[yDir]
      ) {
        continue;
      }


      seen[yDir] =
        true;


      var attack =
        sb122BuildAttackPathForYDir(
          s,
          yDir
        );


      if (
        !attack ||
        !attack.path
      ) {
        continue;
      }


      /*
       * Claw가 떨어지기 전에
       * 공이 이미 바닥에 떨어지는 공격은 제외.
       */
      if (
        attack.landingFrame <=
          warning + 2
      ) {
        continue;
      }


      /*
       * 원래 공격만으로 이미 확정 득점이면
       * 굳이 gauge를 쓸 필요 없음.
       */
      if (
        !sb122OpponentHasAnyBaselineReceive(
          s,
          attack
        )
      ) {
        continue;
      }


      var result =
        sb122EvaluateOffensiveClaw(
          s,
          attack,
          center
        );


      var firstReceive =
        sb123FirstOpponentReceive(
          s,
          attack
        );


      var timingAnchor =
        firstReceive
          ? firstReceive.frame
          : attack.landingFrame;


      var timingGap =
        Math.abs(
          timingAnchor -
          warning
        );


      /*
       * Full gauge fallback에서는
       * PRE_STRIKE_SURVIVAL도 완전 배제하지 않는다.
       *
       * 이유:
       * 이건 80/90의 일반 pressure가 아니라
       * 이미 cap에 걸린 100 gauge를
       * 실제 공격과 연계해서 소비하는 fallback.
       */
      var score =
        10000 -
        timingGap * 80;


      if (
        yDir === -1
      ) {
        score += 800;
      }


      if (
        result.forcedKill
      ) {
        score += 10000;
      } else if (
        result.reason !==
          'PRE_STRIKE_SURVIVAL'
      ) {
        score += 1200;
      }


      var candidate = {
        x:
          center,

        score:
          score,

        pressureLevel:
          result.forcedKill
            ? 3
            : 1,

        routes:
          typeof result.routes === 'number'
            ? result.routes
            : 99,

        source:
          'FULL_GAUGE_COMBO_' +
          shotName(
            attackLock.xAbs,
            yDir
          ),

        landingFrame:
          attack.landingFrame,

        landingX:
          attack.landingX,

        overrideY:
          yDir,

        yDir:
          yDir,

        fromAttackLock:
          true,

        result:
          result
      };


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


  /*
   * =====================================================
   * B. 이미 power-hit이 날아간 경우
   * =====================================================
   */
  var live =
    sb122BuildOurAttackPath(
      s
    );


  if (
    live &&
    live.path &&
    live.landingFrame >
      warning + 2 &&
    sb122OpponentHasAnyBaselineReceive(
      s,
      live
    )
  ) {

    var liveResult =
      sb122EvaluateOffensiveClaw(
        s,
        live,
        center
      );


    var liveReceive =
      sb123FirstOpponentReceive(
        s,
        live
      );


    var liveAnchor =
      liveReceive
        ? liveReceive.frame
        : live.landingFrame;


    var liveGap =
      Math.abs(
        liveAnchor -
        warning
      );


    var liveScore =
      9000 -
      liveGap * 80;


    if (
      liveResult.forcedKill
    ) {
      liveScore += 10000;
    } else if (
      liveResult.reason !==
        'PRE_STRIKE_SURVIVAL'
    ) {
      liveScore += 1200;
    }


    var liveCandidate = {
      x:
        center,

      score:
        liveScore,

      pressureLevel:
        liveResult.forcedKill
          ? 3
          : 1,

      routes:
        typeof liveResult.routes === 'number'
          ? liveResult.routes
          : 99,

      source:
        'FULL_GAUGE_LIVE_POWER',

      landingFrame:
        live.landingFrame,

      landingX:
        live.landingX,

      result:
        liveResult
    };


    if (
      !best ||
      liveCandidate.score >
        best.score
    ) {
      best =
        liveCandidate;
    }
  }


  /*
   * 공격 direction을 바꿔야 하는 combo라면
   * 실제 attackLock도 같이 수정.
   */
  if (
    best &&
    best.fromAttackLock &&
    typeof best.yDir === 'number'
  ) {

    attackLock.yDir =
      best.yDir;


    attackLock.name =
      shotName(
        attackLock.xAbs,
        best.yDir
      );


    attackLock.tierName =
      'SKILL_FULL_GAUGE_RELEASE';
  }


  return best;
}



function sb123ChooseSkillCast(s) {
  /*
   * =====================================================
   * 0순위: FORCED KILL
   * =====================================================
   */
  var forced =
    sb122ChooseForcedKillCast(
      s
    );


  if (
    forced
  ) {

    forced.strategicReason =
      'FORCED_KILL';


    forced.strategicUrgency =
      100;


    return forced;
  }


  /*
   * Skill 사용 불가.
   */
  if (
    !sb122SkillAvailable(s) ||
    s.self.gauge <
      sb122ClawCost(s) ||
    s.self.claw ||
    s.self.state >= 4 ||
    s.tick <=
      sb122CastPendingUntil
  ) {

    return null;
  }


  var gauge =
    s.self.gauge;


  var gaugeMax =
    sb123GaugeMax(s);


  var context =
    sb123StrategicUrgency(
      s
    );


  var attack =
    sb122BuildOurAttackPath(
      s
    );


  var pressure =
    null;


  if (
    attack
  ) {

    pressure =
      sb123FindBestPressureCast(
        s,
        attack
      );
  }


  /* =====================================================
   * 1순위: GAUGE FULL
   * =====================================================
   *
   * 중요한 변경:
   *
   * 100 gauge를 pressure>=2가 나올 때까지
   * 무한정 들고 있지 않는다.
   *
   * 하지만 blind cast도 하지 않는다.
   *
   * 1) 좋은 pressure 있으면 사용
   * 2) 없으면 다음 실제 공격을
   *    Full-Gauge Combo로 전환해서 사용
   */
  if (
    gauge >= gaugeMax
  ) {

    if (
      pressure &&
      pressure.pressureLevel >= 2
    ) {

      pressure.strategicReason =
        'GAUGE_FULL_GOOD_WINDOW';


      pressure.strategicUrgency =
        100;


      return pressure;
    }


    var release =
      sb123FindFullGaugeReleaseCast(
        s
      );


    if (
      release
    ) {

      release.strategicReason =
        'GAUGE_FULL_RELEASE';


      release.strategicUrgency =
        100;


      return release;
    }


    /*
     * 아직 실제 공격 window 자체가 없으면
     * 아무 데나 쏘지 않고 다음 공격까지 잠깐 대기.
     *
     * attackLock이 생기는 순간 위 release planner가
     * UP trajectory까지 만들어서 소비하게 된다.
     */
    return null;
  }


  /* =====================================================
   * 2순위: MATCH EMERGENCY
   * =====================================================
   */

  if (
    context.reason ===
      'OPP_MATCH_POINT'
  ) {

    if (
      pressure
    ) {

      pressure.strategicReason =
        'OPP_MATCH_POINT';


      pressure.strategicUrgency =
        100;


      return pressure;
    }


    return null;
  }


  if (
    context.reason ===
      'MY_MATCH_POINT'
  ) {

    if (
      pressure &&
      pressure.pressureLevel >= 2
    ) {

      pressure.strategicReason =
        'MY_MATCH_POINT';


      pressure.strategicUrgency =
        95;


      return pressure;
    }


    return null;
  }


  /* =====================================================
   * 3순위: GAUGE 90+
   * =====================================================
   */
  if (
    gauge >=
      gaugeMax - 10
  ) {

    if (
      pressure &&
      pressure.pressureLevel >= 2
    ) {

      pressure.strategicReason =
        'GAUGE_90_PLUS';


      pressure.strategicUrgency =
        90;


      return pressure;
    }


    return null;
  }


  /* =====================================================
   * 4순위: GAUGE 80+
   * =====================================================
   */
  if (
    gauge >=
      gaugeMax - 20
  ) {

    if (
      pressure &&
      pressure.pressureLevel >= 3
    ) {

      pressure.strategicReason =
        'GAUGE_80_PLUS';


      pressure.strategicUrgency =
        80;


      return pressure;
    }


    return null;
  }


  /* =====================================================
   * 5순위: 기타 경기 상황
   * =====================================================
   */
  if (
    context.urgency >= 85
  ) {

    if (
      pressure &&
      pressure.pressureLevel >= 2
    ) {

      pressure.strategicReason =
        context.reason;


      pressure.strategicUrgency =
        context.urgency;


      return pressure;
    }


    return null;
  }


  if (
    context.urgency >= 60
  ) {

    if (
      pressure &&
      pressure.pressureLevel >= 3
    ) {

      pressure.strategicReason =
        context.reason;


      pressure.strategicUrgency =
        context.urgency;


      return pressure;
    }
  }


  return null;
}


/* =========================================================
 * OFFENSIVE CLAW MINIMAX
 * ========================================================= */

function sb122BuildOurAttackPath(s){
  if(
    s.ball.isPowerHit===true&&
    outbound(
      s,
      s.ball.xVelocity
    )
  ){
    var liveSim=
      simulateBall(
        s.ball,
        85
      );

    var livePath=
      sb122PathFromSimulation(
        liveSim,
        0
      );

    if(
      liveSim.landed&&
      onOppSide(
        s,
        liveSim.landingX
      )
    ){
      return {
        source:'LIVE_POWER',
        path:livePath,
        landingFrame:
          liveSim.landingFrame,
        landingX:
          liveSim.landingX
      };
    }
  }

  if(
    attackLock&&
    typeof attackLock.expectedContactTick===
      'number'
  ){
    var contactIn=
      attackLock.expectedContactTick-
      s.tick;

    if(
      contactIn>=1&&
      contactIn<=18
    ){
      var b=cloneBall(s.ball);

      for(
        var f=1;
        f<=contactIn;
        f++
      ){
        var ev=stepBall(b);

        if(ev.ground){
          return null;
        }
      }

      var contactBall={
        x:b.x,
        y:b.y,
        vx:b.vx,
        vy:b.vy
      };

      var power=
        simulatePowerFrom(
          s,
          contactBall,
          attackLock.xAbs,
          attackLock.yDir,
          85
        );

      if(
        !power||
        !power.landed||
        !onOppSide(
          s,
          power.landingX
        )
      ){
        return null;
      }

      return {
        source:
          'PLANNED_'+
          attackLock.name,

        path:
          sb122PathFromSimulation(
            power,
            contactIn
          ),

        landingFrame:
          contactIn+
          power.landingFrame,

        landingX:
          power.landingX
      };
    }
  }

  return null;
}

function sb122BuildAttackPathForYDir(
  s,
  yDir
){
  if(
    !attackLock||
    typeof attackLock.expectedContactTick!==
      'number'
  ){
    return null;
  }

  var contactIn=
    attackLock.expectedContactTick-
    s.tick;

  if(
    contactIn<1||
    contactIn>18
  ){
    return null;
  }

  var b=cloneBall(s.ball);

  for(
    var f=1;
    f<=contactIn;
    f++
  ){
    var ev=stepBall(b);

    if(ev.ground){
      return null;
    }
  }

  var contactBall={
    x:b.x,
    y:b.y,
    vx:b.vx,
    vy:b.vy
  };

  var power=
    simulatePowerFrom(
      s,
      contactBall,
      attackLock.xAbs,
      yDir,
      85
    );

  if(
    !power||
    !power.landed||
    !onOppSide(
      s,
      power.landingX
    )
  ){
    return null;
  }

  return {
    source:
      'COMBO_'+
      shotName(
        attackLock.xAbs,
        yDir
      ),

    path:
      sb122PathFromSimulation(
        power,
        contactIn
      ),

    landingFrame:
      contactIn+
      power.landingFrame,

    landingX:
      power.landingX,

    yDir:yDir,
    contactIn:contactIn
  };
}

function sb122OpponentPreStrikeTouchSurvives(
  s,
  attack,
  claw,
  warning
){
  if(!attack||!attack.path){
    return false;
  }

  var stun=
    sb122ClawStunFrames(s);

  for(
    var i=0;
    i<attack.path.length;
    i++
  ){
    var p=attack.path[i];

    if(p.frame>=warning){
      break;
    }

    if(!onOppSide(s,p.x)){
      continue;
    }

    var reachable=
      canPlayerTouchPoint(
        s,
        'opp',
        p,
        p.frame
      )||
      sb122OpponentCanReachPathFrom(
        s,
        [p],
        s.opp.x,
        0
      );

    if(!reachable){
      continue;
    }

    /*
     * 공중에서 이미 건드릴 수 있으면
     * one-touch return/trajectory change가 가능하므로
     * forced kill이라고 단정하지 않는다.
     */
    if(
      p.y<
      PLAYER_GROUND_Y-
      HALF+
      4
    ){
      return true;
    }

    /*
     * 지상 body receive 후 buffer하는 모든 주요
     * horizontal contact offset을 검사.
     */
    var offsets=[
      -28,
      -20,
      -12,
      12,
      20,
      28
    ];

    for(
      var oi=0;
      oi<offsets.length;
      oi++
    ){
      var playerX=clamp(
        p.x+
        offsets[oi],
        oppMin(s),
        oppMax(s)
      );

      if(
        Math.abs(
          p.x-playerX
        )>HALF-2
      ){
        continue;
      }

      if(
        Math.abs(
          playerX-
          s.opp.x
        )>
        RUN*p.frame+
        HALF+8
      ){
        continue;
      }

      var bounced=
        sb122NormalBounceBall(
          p,
          playerX
        );

      var after=
        sb122SimulateBallObject(
          bounced,
          75,
          p.frame
        );

      /*
       * Claw가 떨어지기 전에 우리 코트로
       * 넘길 수 있으면 생존.
       */
      for(
        var ai=0;
        ai<after.length;
        ai++
      ){
        if(
          after[ai].frame>
          warning
        ){
          break;
        }

        if(
          onMySide(
            s,
            after[ai].x
          )
        ){
          return true;
        }
      }

      /*
       * buffer 후 일부러 Claw에 맞고
       * 기상 뒤 다시 받을 수 있는가.
       */
      if(
        sb122IsDangerX(
          s,
          claw,
          playerX
        )
      ){
        var recover=
          warning+stun;

        if(
          sb122OpponentCanReachPathFrom(
            s,
            after,
            playerX,
            recover
          )
        ){
          return true;
        }
      }else{
        /*
         * 처음부터 Claw 밖에서 buffer했으면
         * 그대로 2차 receive 가능 여부.
         */
        if(
          sb122OpponentCanReachPathFrom(
            s,
            after,
            playerX,
            p.frame
          )
        ){
          return true;
        }
      }
    }
  }

  return false;
}

function sb122OpponentHasAnyBaselineReceive(
  s,
  attack
){
  if(!attack||!attack.path){
    return false;
  }

  for(
    var i=0;
    i<attack.path.length;
    i++
  ){
    var p=attack.path[i];

    if(!onOppSide(s,p.x)){
      continue;
    }

    if(
      canPlayerTouchPoint(
        s,
        'opp',
        p,
        p.frame
      )
    ){
      return true;
    }
  }

  return sb122OpponentCanReachPathFrom(
    s,
    attack.path,
    s.opp.x,
    0
  );
}

function sb122EvaluateOffensiveClaw(
  s,
  attack,
  centerX
){
  var warning=
    sb122ClawWarning(s);

  var stun=
    sb122ClawStunFrames(s);

  var claw={
    centerX:centerX,
    framesUntilStrike:warning
  };

  /*
   * Claw 전에 touch해서 살아나는 route가
   * 하나라도 있으면 forced kill 아님.
   */
  if(
    sb122OpponentPreStrikeTouchSurvives(
      s,
      attack,
      claw,
      warning
    )
  ){
    return {
      forcedKill:false,
      reason:'PRE_STRIKE_SURVIVAL',
      routes:1
    };
  }

  var survivalRoutes=0;

  /*
   * ROUTE 1:
   * Claw 밖으로 피하고 난 뒤 receive.
   */
  var safeXs=
    sb122SafePositionsAtStrike(
      s,
      claw,
      'opp',
      s.opp.x,
      warning,
      true
    );

  for(
    var i=0;
    i<safeXs.length;
    i++
  ){
    if(
      sb122OpponentCanReachPathFrom(
        s,
        attack.path,
        safeXs[i],
        warning
      )
    ){
      survivalRoutes++;
      break;
    }
  }

  /*
   * ROUTE 2:
   * 일부러 Claw 안에 남아서 stun된 후
   * 기상하고 receive.
   */
  var dangerXs=
    sb122DangerPositionsAtStrike(
      s,
      claw,
      'opp',
      s.opp.x,
      warning,
      true
    );

  var recoverFrame=
    warning+stun;

  for(
    var di=0;
    di<dangerXs.length;
    di++
  ){
    if(
      sb122OpponentCanReachPathFrom(
        s,
        attack.path,
        dangerXs[di],
        recoverFrame
      )
    ){
      survivalRoutes++;
      break;
    }
  }

  return {
    forcedKill:
      survivalRoutes===0,

    reason:
      survivalRoutes===0
        ?'NO_SURVIVAL_ROUTE'
        :'SURVIVAL_EXISTS',

    routes:survivalRoutes,
    warning:warning,
    recoverFrame:recoverFrame
  };
}


/* =========================================================
 * SB12.3 OFFENSIVE CLAW GEOMETRY
 *
 * 공격용 Claw 전체 범위가 상대가 실제 존재할 수 있는
 * court 영역 밖으로 낭비되지 않도록 강제한다.
 *
 * LEFT:
 *   claw.leftEdge  >= NET + HALF - 1 = 247
 *   claw.rightEdge <= W              = 432
 *
 *   centerX = 295 ~ 384
 *
 * RIGHT:
 *   claw.leftEdge  >= 0
 *   claw.rightEdge <= NET - HALF + 1 = 185
 *
 *   centerX = 48 ~ 137
 * ========================================================= */

function sb123OffensiveClawBounds(s) {
  var clawHalf =
    sb122ClawWidth(s) / 2;


  if (
    isLeft(s)
  ) {
    return {
      min:
        NET +
        HALF -
        1 +
        clawHalf,

      max:
        W -
        clawHalf
    };
  }


  return {
    min:
      clawHalf,

    max:
      NET -
      HALF +
      1 -
      clawHalf
  };
}


function sb123ClampOffensiveClawX(
  s,
  x
) {
  var bounds =
    sb123OffensiveClawBounds(s);


  return clamp(
    x,
    bounds.min,
    bounds.max
  );
}


function sb122OffensiveClawCenters(
  s,
  attack
) {
  var centers = [];


  var bounds =
    sb123OffensiveClawBounds(
      s
    );


  /*
   * 상대 court 내 offensive Claw 유효범위 중앙.
   */
  sb122UniquePush(
    centers,
    (
      bounds.min +
      bounds.max
    ) / 2
  );


  /*
   * 상대 현재 위치.
   *
   * 상대가 net 바로 앞에 있더라도
   * center 자체는 offensive legal range로 clamp.
   */
  sb122UniquePush(
    centers,
    sb123ClampOffensiveClawX(
      s,
      s.opp.x
    )
  );


  /*
   * 공격 landing 위치.
   */
  if (
    attack &&
    typeof attack.landingX === 'number'
  ) {
    sb122UniquePush(
      centers,
      sb123ClampOffensiveClawX(
        s,
        attack.landingX
      )
    );
  }


  /*
   * Claw strike 시점 부근의 ball path.
   *
   * 이것 역시 legal offensive range 안으로 제한.
   */
  if (
    attack &&
    attack.path
  ) {
    for (
      var i = 0;
      i < attack.path.length;
      i += 3
    ) {
      var p =
        attack.path[i];


      if (
        onOppSide(
          s,
          p.x
        ) &&
        p.frame >=
          sb122ClawWarning(s) - 5
      ) {
        sb122UniquePush(
          centers,
          sb123ClampOffensiveClawX(
            s,
            p.x
          )
        );
      }
    }
  }


  /*
   * legal offensive region 전체를
   * 6px 간격으로 추가 탐색.
   *
   * 기존 12px보다 조금 촘촘하게 탐색하되,
   * 상대 court 밖의 낭비성 center는 절대 생성하지 않는다.
   */
  for (
    var x = bounds.min;
    x <= bounds.max;
    x += 6
  ) {
    sb122UniquePush(
      centers,
      x
    );
  }


  /*
   * 마지막 endpoint도 반드시 포함.
   */
  sb122UniquePush(
    centers,
    bounds.max
  );


  return centers;
}


function sb122FindForcedKillCenterForAttack(
  s,
  attack
){
  if(!attack||!attack.path){
    return null;
  }

  var warning=
    sb122ClawWarning(s);

  /*
   * 공이 Claw보다 먼저 바닥에 떨어지면
   * 이 Claw와 결합한 kill 판정 의미가 없음.
   */
  if(
    attack.landingFrame<=
    warning
  ){
    return null;
  }

  var centers=
    sb122OffensiveClawCenters(
      s,
      attack
    );

  var best=null;

  for(
    var i=0;
    i<centers.length;
    i++
  ){
    var center=
      sb123ClampOffensiveClawX(
        s,
        centers[i]
      );

    var result=
      sb122EvaluateOffensiveClaw(
        s,
        attack,
        center
      );

    if(!result.forcedKill){
      continue;
    }

    /*
     * 여러 forced-kill center가 있으면
     * 상대와 ball landing 둘 다에서
     * 너무 이상하게 떨어진 좌표는 피한다.
     */
    var stabilityCost=
      Math.abs(
        center-
        s.opp.x
      )*0.5+
      Math.abs(
        center-
        attack.landingX
      )*0.2;

    var candidate={
      x:center,
      score:
        100000-
        stabilityCost,
      source:attack.source,
      landingFrame:
        attack.landingFrame,
      landingX:
        attack.landingX,
      result:result,
      yDir:
        typeof attack.yDir==='number'
          ?attack.yDir
          :null,
      contactIn:
        attack.contactIn||null
    };

    if(
      !best||
      candidate.score>
      best.score
    ){
      best=candidate;
    }
  }

  return best;
}

function sb122ChooseForcedKillCast(s){
  if(
    !sb122SkillAvailable(s)||
    s.self.gauge<
      sb122ClawCost(s)||
    s.self.claw||
    s.self.state>=4||
    s.opp.state>=5||
    s.tick<=
      sb122CastPendingUntil
  ){
    return null;
  }

  var warning=
    sb122ClawWarning(s);

  /*
   * 공격을 이미 준비 중이면 같은 xAbs/contact를 유지한 채
   * UP/FLAT/DOWN을 전부 비교해서
   * Claw와 결합했을 때 checkmate가 되는 방향을 찾는다.
   */
  if(attackLock){
    var contactIn=
      attackLock.expectedContactTick-
      s.tick;

    var group=Math.max(
      1,
      s.config.tickFrameGroupSize||3
    );

    var directionReady=
      group+
      CONTROL_DELAY+
      1;

    var dirs=[
      attackLock.yDir,
      -1,
      0,
      1
    ];

    var seenDir={};
    var bestCombo=null;

    for(
      var di=0;
      di<dirs.length;
      di++
    ){
      var yDir=dirs[di];

      if(seenDir[yDir]){
        continue;
      }

      seenDir[yDir]=true;

      /*
       * FLAT/DOWN으로 바꿀 시간이 물리적으로
       * 부족하면 후보에서 제외.
       */
      if(
        yDir!==attackLock.yDir&&
        yDir!==-1&&
        contactIn<=directionReady
      ){
        continue;
      }

      var comboAttack=
        sb122BuildAttackPathForYDir(
          s,
          yDir
        );

      if(!comboAttack){
        continue;
      }

      if(
        comboAttack.landingFrame<=
        warning
      ){
        continue;
      }

      /*
       * 원래부터 상대가 못 받는 공이면
       * Gauge 50을 쓸 이유가 없다.
       */
      if(
        !sb122OpponentHasAnyBaselineReceive(
          s,
          comboAttack
        )
      ){
        continue;
      }

      var comboCast=
        sb122FindForcedKillCenterForAttack(
          s,
          comboAttack
        );

      if(!comboCast){
        continue;
      }

      comboCast.score+=
        Math.max(
          0,
          80-
          comboAttack.landingFrame
        )*5;

      comboCast.yDir=yDir;

      if(
        !bestCombo||
        comboCast.score>
        bestCombo.score
      ){
        bestCombo=comboCast;
      }
    }

    if(bestCombo){
      /*
       * 같은 attack contact에서 direction만
       * Claw와 가장 강하게 연계되는 쪽으로 수정.
       */
      if(
        bestCombo.yDir!==
        attackLock.yDir
      ){
        attackLock.yDir=
          bestCombo.yDir;

        attackLock.name=
          shotName(
            attackLock.xAbs,
            bestCombo.yDir
          );
      }

      attackLock.tierName=
        'SKILL_FORCED_KILL';

      bestCombo.overrideY=
        bestCombo.yDir;

      return bestCombo;
    }
  }

  /*
   * 이미 power-hit이 날아간 뒤에도
   * 그 trajectory + Claw가 확정 kill이면 사용.
   */
  var attack=
    sb122BuildOurAttackPath(s);

  if(!attack){
    return null;
  }

  if(
    attack.landingFrame<=
    warning
  ){
    return null;
  }

  /*
   * Claw 없이도 원래 못 받는 공격에는
   * Gauge를 낭비하지 않는다.
   */
  if(
    !sb122OpponentHasAnyBaselineReceive(
      s,
      attack
    )
  ){
    return null;
  }

  return sb122FindForcedKillCenterForAttack(
    s,
    attack
  );
}

function sb122SkillOverlay(
  s,
  baseAction
){
  if(
    !baseAction||
    typeof baseAction.x!=='number'||
    typeof baseAction.y!=='number'||
    typeof baseAction.hit!=='number'
  ){
    return baseAction;
  }

  var action={
    x:baseAction.x,
    y:baseAction.y,
    hit:baseAction.hit
  };

  if(!sb122SkillAvailable(s)){
    return action;
  }

  /*
   * =====================================================
   * DEFENSE
   * =====================================================
   */
  if(s.opp.claw){
    var plan=
      sb122PlanDefense(
        s,
        action
      );

    action=
      sb122ApplyDefensePlan(
        s,
        action,
        plan
      );
  }else{
    sb122DefensePlan=null;
    sb122LastPlanKey='';
  }

  /*
   * =====================================================
   * OFFENSE
   * =====================================================
   */
  var cast=
    sb123ChooseSkillCast(s);

  if(cast){
    action.skillX=
      sb123ClampOffensiveClawX(
        s,
        cast.x
      );

    /*
     * 공격 direction까지 planner가 바꿨다면
     * 이미 공중인 동안 즉시 반영.
     */
    if(
      typeof cast.overrideY===
        'number'&&
      (
        s.self.state===1||
        s.self.state===2
      )
    ){
      action.y=cast.overrideY;
      action.hit=1;
    }

    sb122CastPendingUntil=
      s.tick+
      Math.max(
        4,
        (
          s.config.tickFrameGroupSize||
          3
        )+
        2
      );

   log(
  '[SB12.3 CAST]',
  'tick='+s.tick,

  'gauge='+
    s.self.gauge,

  'aim='+
    Math.round(
      action.skillX
    ),

  'reason='+
    cast.strategicReason,

  'urgency='+
    cast.strategicUrgency,

  'pressure='+
    (
      cast.pressureLevel == null
        ? 'KILL'
        : cast.pressureLevel
    ),

  'routes='+
    (
      cast.routes == null
        ? 0
        : cast.routes
    ),

  'attack='+
    cast.source
);
  }

  return action;
}


/* =========================================================
 * FINAL DECIDE WRAPPER
 * ========================================================= */

decide=function(snapshot){
  var s=snapshot;

  /*
   * 일부러 Claw를 맞은 뒤에는 기존 SB12.1이
   * attackLock/sentBall을 잘못 기억하지 않도록
   * 먼저 recovery 상태를 정리.
   */
  if(sb122SkillAvailable(s)){
    sb122PreBaseRecovery(s);
  }

  /*
   * 기본 공수 판단은 검증된 SB12.1을 그대로 사용.
   */
  var baseAction=
    SB121_BASE_DECIDE(s);

  /*
   * 그 결과 위에 skill-aware survival/checkmate
   * planner를 적용.
   */
  var finalAction=
    sb122SkillOverlay(
      s,
      baseAction
    );

  sb122PostBaseRecovery(s);

  sb122PrevOppX=s.opp.x;
  sb122PrevTick=s.tick;

  sb122LastClawSeen=
    s.opp.claw
      ?sb122ClawSignature(
          s.opp.claw
        )
      :null;

  return finalAction;
};