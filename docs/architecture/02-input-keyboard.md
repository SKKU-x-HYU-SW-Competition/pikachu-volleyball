# 02. 키 입력 처리

> 이전 문서: [01-game-loop-and-physics.md](./01-game-loop-and-physics.md) · 목차: [00-overview.md](./00-overview.md)

## 1. 관련 파일

| 파일 | 역할 |
|---|---|
| [keyboard.js](../../src/resources/js/keyboard.js) | 키보드 입력을 읽어 `PikaUserInput` 형태로 변환 |
| [physics.js:102](../../src/resources/js/physics.js#L102) | `PikaUserInput` — 입력의 공통 인터페이스(모양) 정의. `keyboard.js`가 이를 상속 |
| [pikavolley.js:42-51](../../src/resources/js/pikavolley.js#L42-L51) | 실제 키 매핑(어떤 키가 어떤 역할인지) 등록 지점 |

## 2. 키 매핑

Controller 생성 시점에 플레이어별로 `PikaKeyboard` 인스턴스를 만든다 ([pikavolley.js:42-51](../../src/resources/js/pikavolley.js#L42-L51)):

```js
this.keyboardArray = [
  new PikaKeyboard('KeyD', 'KeyG', 'KeyR', 'KeyV', 'KeyZ', 'KeyF'), // player1: 좌,우,상,하,파워히트,우하단(대각)
  new PikaKeyboard('ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'), // player2
];
```

- 값은 `KeyboardEvent.code` 문자열([MDN 참고](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/code/code_values))이다.
- 플레이어1만 6번째 인자(`downRight`, 예: `KeyF`)를 갖는다 — 우하단 대각 이동을 위한 별도 키. 눌리면 down+right를 동시에 누른 것과 같은 효과.
- **키를 새로 바인딩하거나 3번째 플레이어(리플레이/관전 등)를 추가하려면** 이 배열 생성부와 `PikaKeyboard` 생성자 인자만 보면 된다.

## 3. `PikaKeyboard` / `Key` 클래스 (keyboard.js)

- `Key` 클래스 ([keyboard.js:109](../../src/resources/js/keyboard.js#L109)): 키 하나에 대해 `window`의 `keydown`/`keyup` 이벤트를 구독해 `isDown` 불리언만 유지하는 가장 작은 단위.
- `PikaKeyboard` 클래스 ([keyboard.js:10](../../src/resources/js/keyboard.js#L10)): `PikaUserInput`을 상속하며, 5~6개의 `Key`를 묶어 `xDirection`/`yDirection`/`powerHit`으로 변환한다.

## 4. 입력이 물리엔진까지 가는 흐름

```
window keydown/keyup 이벤트
   → Key.isDown 갱신 (실시간, 이벤트 발생 즉시)
   → [매 프레임] PikaKeyboard.getInput() 호출  ← gameLoop()가 프레임 시작 시 호출
   → this.xDirection / yDirection / powerHit 값 확정 (그 프레임 동안 고정)
   → round() 상태에서 this.physics.runEngineForNextFrame(this.keyboardArray) 호출 시 그대로 전달
   → physics.js의 physicsEngine()이 각 player의 입력으로 사용
```

핵심은 **"입력 이벤트는 언제든 비동기로 들어오지만, 실제로 게임 로직이 보는 값은 프레임당 딱 한 번 `getInput()`이 호출될 때 스냅샷된다"**는 점이다 ([keyboard.js:44-78](../../src/resources/js/keyboard.js#L44-L78) `getInput()`, 그리고 이를 호출하는 [pikavolley.js:137-138](../../src/resources/js/pikavolley.js#L137-L138)).

- `xDirection`: 왼쪽키 우선(-1), 오른쪽 또는 대각키(+1), 없으면 0
- `yDirection`: 위쪽키(-1), 아래 또는 대각키(+1), 없으면 0
- `powerHit`: **엣지 트리거(edge-triggered)** — 키가 눌려있는 동안 계속 1이 아니라, "직전 프레임엔 안 눌려있었는데 이번 프레임에 눌림"일 때만 1 ([keyboard.js:71-77](../../src/resources/js/keyboard.js#L71-L77), `powerHitKeyIsDownPrevious` 플래그로 구현). 즉 키를 누르고 있어도 자동으로 연타되지 않는다.

## 5. 구독/해제

`subscribe()` / `unsubscribe()` ([keyboard.js:83-102](../../src/resources/js/keyboard.js#L83-L102))로 `window` 이벤트 리스너를 켜고 끌 수 있다. 옵션 화면 등에서 키 재할당(리바인딩) UI를 만들 때, 특정 키보드의 리스너를 잠깐 끄고 새 `Key`로 교체하는 용도로 쓰인다 ([ui.js](../../src/resources/js/ui.js)에서 옵션 관련 처리 참고).

## 6. 확장 시 참고사항

- **새 입력(예: 특수 스킬 버튼) 추가** → `PikaUserInput` ([physics.js:102](../../src/resources/js/physics.js#L102))에 필드 추가 → `PikaKeyboard`에 해당 `Key` 추가 및 `getInput()`에서 값 계산 → `pikavolley.js`의 매핑 배열에 키 코드 추가 → `physics.js`의 `physicsEngine`/`processPlayerMovementAndSetPlayerPosition`에서 실제로 사용.
- 컴퓨터(AI) 플레이어는 이 키보드 경로를 타지 않고, `physics.js`의 `letComputerDecideUserInput`이 직접 `PikaUserInput` 모양의 값을 만들어 넣는다 (자세한 내용은 [01-game-loop-and-physics.md](./01-game-loop-and-physics.md) 3.3절). 새 입력을 추가하면 AI 쪽에도 대응하는 의사결정 로직을 넣어야 컴퓨터가 그 동작을 쓸 수 있다.
