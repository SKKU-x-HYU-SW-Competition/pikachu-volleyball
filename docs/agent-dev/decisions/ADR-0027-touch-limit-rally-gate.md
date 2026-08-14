# ADR-0027 — 터치 제한도 `isRallyLive()`를 쓰도록 통일

| | |
|---|---|
| 상태 | **OPEN (미착수)** — 제안과 근거만 정리. 코드는 아직 안 고쳤다 |
| 제기일 | 2026-08-12 |
| 제기자 | Claude Code (`develop` → `develop-skill` 병합 `2bffabd` 중 발견) |
| 관련 | [ADR-0024](ADR-0024-rally-boundary-for-skills.md)(같은 게이트를 스킬 쪽에서 이미 정정), [ADR-0026](ADR-0026-touch-limit-vs-smash-logic.md) |
| 대상 | [`rules/touchLimit.js:95`](../../../src/resources/js/rules/touchLimit.js#L95) |

## 배경

[ADR-0024](ADR-0024-rally-boundary-for-skills.md)에서 "랠리가 살아 있다"는 판정을 `skill/rally.js`의
`isRallyLive()` 한 곳으로 모았다. 이유는 게이지와 claw가 각자 판정하다 **한쪽만 고쳐지는 것**을
막기 위해서였고, ADR-0024 §결정은 "앞으로 추가되는 스킬도 이걸 쓸 것"이라고 적었다.

그런데 `develop`에서 온 `rules/touchLimit.js`는 ADR-0024가 틀렸다고 정리한 바로 그 판정을 쓰고
있다:

```js
// rules/touchLimit.js:95
if (pikaVolley.state !== pikaVolley.round) {
  this.resetPossession();
  this.previousBallIsOnLeft = null;
  return;
}
```

두 브랜치에서 같은 시기에 각자 작성된 코드라 서로를 몰랐던 것이고, 누구의 실수도 아니다. 다만
병합된 지금은 **한 저장소 안에 랠리 종료 판정이 두 가지 버전으로 존재한다.**

## 무엇이 실제로 어긋나는가

`round()`는 공이 땅에 닿은 뒤에도 슬로모션 6프레임(체감 약 1.2초) 동안 계속 돈다
([ADR-0024](ADR-0024-rally-boundary-for-skills.md) §배경). 그 구간에서 `state`는 여전히 `round`이므로
위 게이트는 **참이 되지 않고**, 트래커는 계속 관찰한다. 결과:

1. **점수가 확정된 뒤의 접촉이 카운트에 들어간다.** 착지한 공은 튕겨 오르고, 그걸 플레이어가
   건드리면 접촉으로 잡힌다. 그 접촉은 이미 끝난 랠리의 것이다.
2. **원리적으로는 끝난 랠리에서 득점이 한 번 더 날 수 있다.** 그 구간에 카운트가 5에 닿으면
   `awardPoint()`가 호출되는데, `forceNextRound()`의 가드는
   `isDuringMatch(pikaVolley) || gameEnded`뿐이고([`operator/console.js:143`](../../../src/resources/js/operator/console.js#L143))
   `state === round`이면 `isDuringMatch`는 참이다. `adjustScore()`에도 "이미 이 랠리 점수가
   났는가"를 막는 장치는 없다.

**2번의 실현 가능성은 낮다.** 슬로모션 구간은 엔진 프레임 기준 6프레임뿐이고, 접촉은
`false → true` 엣지로만 세므로 그 안에 5회를 채우기는 사실상 어렵다. 또 공이 튕겨 네트를 넘거나
반대편으로 가면 `previousBallIsOnLeft` 변화로 `resetPossession()`이 걸려 카운트가 지워지기도 한다.
즉 **지금 당장 눈에 보이는 버그는 아니다.**

그래서 이 ADR의 논거는 "버그가 났다"가 아니라 **판정이 두 벌로 존재한다**는 것이다. ADR-0024가
게이지·claw 세 곳을 한 번에 고쳐야 했던 이유가 정확히 이거였다.

## 제안

`touchLimit.js`가 `skill/rally.js`의 `isRallyLive()`를 쓰도록 바꾼다.

```js
import { isRallyLive } from '../skill/rally.js';
// ...
if (!isRallyLive(pikaVolley)) {
  this.resetPossession();
  this.previousBallIsOnLeft = null;
  return;
}
```

### 검토가 필요한 지점

- **의존 방향.** `rules/`가 `skill/`을 import하게 된다. `isRallyLive`는 스킬 고유 개념이 아니라
  "엔진 랠리 상태 읽기"이므로, 파일 위치를 `skill/rally.js`에서 더 중립적인 곳(예: `rules/rally.js`
  또는 공용 유틸)으로 옮기는 편이 구조상 맞을 수 있다. **옮기면 ADR-0024가 만든 import 3곳을
  같이 고쳐야 한다.**
- **연습 모드.** `roundEnded`는 연습 모드에서 세팅되지 않으므로
  ([`pikavolley.js:367-372`](../../../src/resources/js/pikavolley.js#L367-L372)) `isRallyLive`는 계속
  참이고, 터치 제한 동작은 지금과 같다. 영향 없음.
- **`gameEnded` 구간.** `isRallyLive`는 `gameEnded`도 본다. 즉 승패 메시지가 뜬 동안 터치 제한이
  득점을 만드는 경로가 추가로 막힌다 — 현재 게이트로는 막히지 않는다. 이건 개선이다.

## 왜 지금 안 고쳤는가

병합(`2bffabd`) 당시 이 파일은 `develop` 쪽에서 온 남의 트랙 코드였고, 병합 커밋에서 남의 규칙
코드의 동작을 바꾸는 것은 충돌 해소 범위를 넘는다고 판단했다. 또 위 "의존 방향" 논점이 있어
파일 이동까지 얽히면 ADR-0024의 결과물을 다시 건드려야 한다.

**작성자(SeungJoon)와 회의에서 합의한 뒤 한 번에 처리하는 것을 제안한다.** 급하지 않다 —
위에 적었듯 현재 실현 가능성이 낮은 경로다.
