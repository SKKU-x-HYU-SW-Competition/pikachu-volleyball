# 05. 새 스킬 추가 가이드 (Skill Extension)

> **이 문서는 "현재 코드 기준" 스냅샷이자 시작점입니다, 확정 설계 문서가 아닙니다.** 작성 시점:
> 2026-07-29. 우리 저장소에는 아직 스킬 시스템이 없습니다 (AGENTS.md §3의 4번째 트랙 "스킬/에셋",
> 후순위, 착수 전). 이 문서는 (1) 우리 엔진에서 스킬을 넣을 수 있는 지점을 복습하고, (2) 원본
> 프로젝트의 한 외부 포크가 실제로 스킬 시스템을 어떻게 짰는지 케이스 스터디로 뜯어본 뒤, (3) 그
> 통찰을 우리 코드베이스(엔진 파일 무수정 원칙, 3필드 고정 봇 프로토콜)에 적용하려면 어떤 방향이
> 있는지 제시합니다. 5절은 방향 제시일 뿐 확정 설계가 아니며, 실제 착수 시엔 평소대로 stub +
> ADR 절차([AGENTS.md](../../AGENTS.md) §4)를 따라야 합니다.

## 1. 참고 자료에 대한 안내

**gorisanson(원본) 저장소의 `thunder` 브랜치는 참고하지 않았습니다.** 미리 녹화한 78프레임 입력
배열을 AI 판단 함수에 하드코딩으로 끼워 넣은 1회성 데모라 재사용 가능한 구조가 없고, 방어 기술도
비활성 상태로 남아있어 "어떻게 스킬을 설계하는가"의 본보기가 되기 어렵다고 판단했습니다.

대신 **[DuckLL Super AI Edition](https://github.com/DuckLL/pikachu-volleyball)** (원본을 포크해 만든
독립 프로젝트, [pika.duckll.tw](https://pika.duckll.tw/en/))을 참고했습니다. 이 포크는 우리 저장소의
일부가 아니고, 우리 봇 프로토콜을 전혀 모른 채(당연히 이 대회보다 먼저 존재) 설계된 코드입니다 —
**코드를 그대로 가져다 쓰는 게 아니라 "패턴"만 참고하는 용도**입니다. 라이선스 확인 없이 코드를
그대로 복사해 우리 저장소에 넣지 마세요.

## 2. 복습: 우리 엔진에서 스킬을 넣을 수 있는 지점

[01-game-loop-and-physics.md §4](./01-game-loop-and-physics.md#4-요약-엔진을-고치고-싶다면-어디부터)가
이미 짚어둔 지점을 다시 정리하면:

| 확장 지점 | 위치 | 언제 필요한가 |
|---|---|---|
| `Player.state` 값 체계 (현재 0~6) | [physics.js:185-192](../../src/resources/js/physics.js#L185-L192) | 새로운 "동작 종류"(예: 새 이동 방식) 자체가 필요할 때 |
| `processPlayerMovementAndSetPlayerPosition` | [physics.js:496](../../src/resources/js/physics.js#L496) | 플레이어 이동/점프/다이빙 조건을 바꾸거나 새로 추가할 때 |
| `processCollisionBetweenBallAndPlayer` | [physics.js:678](../../src/resources/js/physics.js#L678) | 공-플레이어 충돌 결과(반사 각도/속도)를 바꿀 때 |

중요한 건, [03-bot-integration.md §0](./03-bot-integration.md#0-핵심-요약-원본-엔진-파일은-한-줄도-안-바뀜)에서
확인했듯 **지금까지 이 지점들을 실제로 건드린 적이 한 번도 없다**는 점입니다 — 봇 입력 기능 전체가
엔진 파일을 한 줄도 안 바꾸고 `keyboardArray`를 갈아 끼우는 방식만으로 구현됐습니다. 이 문서의 핵심
질문은 "스킬도 이 원칙(엔진 무수정)을 지키면서 넣을 수 있는가, 아니면 정말 엔진을 고쳐야 하는가"입니다.

## 3. 케이스 스터디: DuckLL의 `ServeMachine` 패턴

### 3.1 이게 뭘 위해 만들어졌나

DuckLL 포크의 `physics.js`는 원본(1032줄)의 3배가 넘는 3330줄인데, 대부분은 훨씬 정교해진 컴퓨터
AI 로직입니다. `ServeMachine`은 그중 **AI가 서브할 때 쓰는, 이름 붙은 정밀 서브 기술 라이브러리**
("Break net", "Head thunder", "Net V smash" 등)입니다. AI의 전술 결정 로직이 `player.tactics === 3`
(=지금 라운드는 스크립트 서브 기술을 쓰기로 함)을 고르면, 그 랠리의 서브 순간 동안 프레임별 조작권을
`ServeMachine`에 완전히 넘깁니다
([DuckLL physics.js:3080-3083](https://github.com/DuckLL/pikachu-volleyball/blob/dc011bc77891c85f9774e8e6ed8ce465a69b0757/src/resources/js/physics.js#L3080-L3083)):

```js
if (player.tactics === 3) {
  player.serve.executeMove(player, ball, theOtherPlayer, userInput);
  if (player.serve.framesLeft < -1000) {
    player.tactics = 0; // 시퀀스 끝 -> 일반 AI 판단으로 복귀
  }
}
```

**핵심 통찰: 이 시스템은 물리 규칙을 전혀 바꾸지 않습니다.** 새 `Player.state`도, 새 충돌 판정도
없습니다. 순수하게 기존 `xDirection`/`yDirection`/`powerHit` 세 값을 몇 십 프레임에 걸쳐 정해진
순서로 정확하게 내보내는 것뿐입니다. 즉 "새 스킬처럼 보이는 동작"의 상당수는 **새 물리 법칙이 아니라,
기존 3필드 입력을 사람이 손으로 재현하기 힘든 정밀한 타이밍으로 조합한 것**이라는 뜻입니다 — 우리
봇 프로토콜이 3필드로 고정돼 있다는 제약과 정확히 같은 조건에서 이미 실증된 패턴입니다.

### 3.2 구성 요소 3개

| 요소 | 역할 |
|---|---|
| `actionType` | "입력 조합 사전". `forward`, `forwardUpSmash`, `backward` 같은 이름에 `{xDirection, yDirection, powerHit}` 조합을 미리 붙여둠 |
| `player1Formula` / `player2Formula` | "이름 붙은 스킬 하나 = `{action, frames}` 스텝의 배열". 예: `[{action: forward, frames: 4}, {action: wait, frames: 14}, ...]` |
| `ServeMachine` | 지금 스킬의 몇 번째 스텝(`phase`)인지, 그 스텝이 몇 프레임 남았는지(`framesLeft`)를 추적하는 작은 상태 머신 |

`actionType` 정의 예시 ([DuckLL physics.js:3087-3105](https://github.com/DuckLL/pikachu-volleyball/blob/dc011bc77891c85f9774e8e6ed8ce465a69b0757/src/resources/js/physics.js#L3087-L3105)):

```js
const actionType = {
  wait: 0, forward: 1, forwardUp: 2, up: 3, backward: 5, /* ...총 17개... */
};
```

`executeMove()`가 `action`을 실제 3필드로 변환하는 부분 (일부 발췌,
[DuckLL physics.js:3255-3281](https://github.com/DuckLL/pikachu-volleyball/blob/dc011bc77891c85f9774e8e6ed8ce465a69b0757/src/resources/js/physics.js#L3255-L3281)):

```js
if (this.action === actionType.forward) {
  userInput.xDirection = 1;
} else if (this.action === actionType.forwardUpSmash) {
  userInput.xDirection = 1;
  userInput.yDirection = -1;
  userInput.powerHit = 1;
} /* ... */
```

`getNextAction()`이 `framesLeft`가 0이 되면 포뮬러 배열의 다음 스텝으로 넘어가고, 배열 끝에
도달하면 `framesLeft = -1000`으로 "이 스킬 끝났음"을 알립니다 — 그게 위 3.1절의 `if
(player.serve.framesLeft < -1000)` 조건으로 이어집니다. 정리하면 **포뮬러 배열을 재생하는 아주 작은
바이트코드 인터프리터**입니다.

## 4. 케이스 스터디: 새 스킬을 어떻게 추가했나 (`double_attack_serve` 브랜치)

DuckLL 포크의 `double_attack_serve` 브랜치는 이 프레임워크 위에 새 스킬 4개("double jump F/G/R
smash", "double jump fake G")를 실제로 추가한 커밋 이력입니다. 세 가지를 했습니다:

**(1) 포뮬러 배열에 새 항목 추가** — `player1Formula`에 인덱스 10~13을 새로 붙임
([diff](https://github.com/DuckLL/pikachu-volleyball/blob/b44102523668b62a18c2a6669c0c1f5503804f24/src/resources/js/physics.js#L2235-L2287)):

```js
[
  // 10. double jump F smash
  { action: actionType.forward, frames: 4 },
  { action: actionType.wait, frames: 15 },
  { action: actionType.backward, frames: 2 },
  { action: actionType.wait, frames: 3 },
  { action: actionType.forwardUp, frames: 1 },   // 첫 번째 점프
  { action: actionType.forward, frames: 14 },
  { action: actionType.wait, frames: 12 },
  { action: actionType.smash, frames: 1 },         // 공중에서 살짝 건드림(파워히트로 두 번째 점프 유도)
  { action: actionType.forwardUp, frames: 7 },     // 두 번째 점프
  { action: actionType.forwardDownSmash, frames: 1 }, // 진짜 스매시
],
```

**(2) 기존 `actionType`에 없던 동작(`smash`: 방향 없이 순수 파워히트만) 하나를 새로 추가** —
새 스킬 표현에 기존 "입력 조합 사전"이 부족하면 사전 자체를 늘리면 된다는 걸 보여줍니다
([diff](https://github.com/DuckLL/pikachu-volleyball/blob/b44102523668b62a18c2a6669c0c1f5503804f24/src/resources/js/physics.js#L2386-L2422)의
`else if (this.action === actionType.smash) { userInput.powerHit = 1; }` 분기).

**(3) 스킬 개수를 하드코딩 상수 대신 설정 배열의 길이로 바꿈** — `this.skillCount = isPlayer2 ?
SkillTypeForPlayer2Available.length : SkillTypeForPlayer1Available.length`
([diff](https://github.com/DuckLL/pikachu-volleyball/blob/b44102523668b62a18c2a6669c0c1f5503804f24/src/resources/js/physics.js#L2322-L2330)).
`SkillTypeForPlayer1/2Available`는 `ui.js`에서 가져오는 불리언 배열로, 사람이 UI 체크박스로 "AI가
이 스킬을 쓰게 허용할지"를 켜고 끌 수 있게 만든 것입니다 (같은 브랜치의 `ui.js` diff 227줄이 대부분
이 UI).

요약하면, **이 프레임워크 위에서 새 스킬 하나를 추가하는 데 필요한 건 (a) 포뮬러 배열에 새 항목,
(b) 표현이 부족하면 `actionType` 사전 확장, (c) 필요하면 UI 노출 — 세 가지뿐**이었고 물리 엔진의
다른 부분은 전혀 안 건드렸습니다.

## 5. 우리 코드베이스에 적용한다면 (방향 제시, 확정 아님)

전제를 다시 짚으면: 엔진 파일 무수정 원칙([03-bot-integration.md §0](./03-bot-integration.md#0-핵심-요약-원본-엔진-파일은-한-줄도-안-바뀜)),
봇 프로토콜 출력은 `{x, y, hit}` 3필드로 고정([CONTRACTS.md](../agent-dev/CONTRACTS.md) §1.1), 서로
다른 도구로 짠 여러 봇이 같은 인터페이스를 공유해야 함. 이 제약 안에서 두 갈래로 나눠 생각할 수
있습니다.

### Tier A — 타이밍/콤보형 스킬 (새 물리 법칙 불필요)

3절의 핵심 통찰이 그대로 적용됩니다: "정밀한 타이밍의 기존 3필드 조합"으로 표현되는 스킬이라면
엔진도, 봇 프로토콜도 건드릴 필요가 없습니다. 후보로 떠오르는 방향(둘 다 미확정, 예시일 뿐):

- **참가자 봇 코드 스스로 구현** — [04-bot-writing-guide.md §3.1](./04-bot-writing-guide.md#31-로그로-디버깅하기)에서
  이미 다룬 "`decide` 밖 최상위 변수는 틱 사이에 유지된다"는 성질을 그대로 활용해, 봇이 자기만의
  phase/frame 카운터를 두고 몇 틱에 걸쳐 `{x,y,hit}`을 순서대로 반환하면 됨. 엔진/프로토콜 변경 전혀
  없음 — 참가자 각자의 전략 영역.
- **공용 참고 라이브러리 제공** — `ServeMachine`처럼 `actionType`/포뮬러 배열/step 인터프리터를
  `bot/` 밑에 참고용 헬퍼로 만들어 [`exampleBots.js`](../../src/resources/js/bot/exampleBots.js)처럼
  제공. 역시 엔진/프로토콜 변경 없음, 참가자가 참고만 하거나 그대로 가져다 써도 됨.

### Tier B — 정말 새로운 물리 규칙이 필요한 스킬

기존 3필드의 조합만으로는 표현이 안 되는, 진짜 새로운 동작(예: 새로운 이동 방식, 새로운 충돌 판정)이
필요하다면 2절의 확장 지점(`Player.state`, `processPlayerMovementAndSetPlayerPosition`,
`processCollisionBetweenBallAndPlayer`)을 실제로 건드려야 합니다. 이 경우:

- 우리 프로젝트에서 엔진 파일을 실제로 수정하는 **첫 사례**가 됩니다 → [AGENTS.md](../../AGENTS.md) §4의
  절차대로 반드시 [CONTRACTS.md](../agent-dev/CONTRACTS.md) 갱신 + 새 ADR이 필요합니다.
- 봇이 이 스킬을 쓰게 하려면 `{x, y, hit}` 3필드로는 표현이 안 될 수 있습니다 — 이러면 봇 프로토콜
  자체(스냅샷 필드, 출력 필드)를 바꿔야 하는 얘기가 되므로, 이것도 CONTRACTS.md 버전업 + ADR 대상이고
  기존에 이미 짜여진 모든 참가자 봇 코드와의 하위 호환도 함께 고려해야 합니다.

### 결론

`ServeMachine` 사례가 보여주듯 상당수의 "스킬"은 Tier A(순수 입력 조합)로 충분할 가능성이 높습니다.
Tier B는 정말 기존 3필드 조합으로 흉내 낼 수 없는 새 동작이 필요할 때만, 신중하게(그리고 반드시 ADR과
함께) 접근하세요.

## 6. 자주 나올 질문

- **DuckLL 코드를 그대로 복사해도 되나?** → 패턴만 참고하는 용도로 이 문서에 인용했습니다. 그대로
  복사해 저장소에 넣기 전에 라이선스/출처를 확인하세요. 또한 그 포크는 우리 봇 프로토콜을 모르는
  채 AI 서브 전용으로 설계된 코드라 그대로 이식되지 않고, 패턴(포뮬러 배열 + 인터프리터)만 가져오는
  정도로 봐야 합니다.
- **`ServeMachine`은 사람이 누르는 특수 키인가?** → 아니요. `player.tactics === 3`일 때만 동작하는,
  **컴퓨터 AI 전용 서브 전술** 중 하나입니다. 사람이 손으로 재현하려면 그 프레임 시퀀스를 정확한
  타이밍으로 직접 눌러야 하니(상당히 어려움), 원래 취지는 "고수의 손기술을 코드로 재현해 AI를
  강하게 만드는 것"에 가깝습니다.
- **참고로, DuckLL의 `physics.js`는 `ui.js`를 직접 `import`합니다** (`SkillTypeForPlayer1Available`
  등, 4절 참고) — 우리 프로젝트라면 [00-overview.md](./00-overview.md)의 MVC 원칙(Model이 View/UI를
  모른다)에 어긋나는 결합입니다. 패턴을 가져오더라도 이 부분은 그대로 따라 하지 마세요 — 참가자
  설정값은 물리 엔진이 아니라 그걸 호출하는 쪽(예: `bot/testSetup.js` 같은 조립 계층)에서 넘겨주는
  식으로 유지해야 합니다.
- **우리도 꼭 이 구조를 그대로 써야 하나?** → 아니요. 5절은 방향 제시일 뿐 확정 설계가 아닙니다.
  실제 설계는 착수 시점에 별도 ADR/회의로 정하세요.
