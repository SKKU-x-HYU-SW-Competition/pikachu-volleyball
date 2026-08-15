# 예제 1: Minimal — 뼈대

**목표**: 봇 파일이 가져야 할 최소 형태가 뭔지 확인합니다. 이 봇은 아무것도
하지 않지만, 게임은 정상적으로 돌아갑니다 (그냥 서서 공을 맞고 지는 봇).

## JavaScript

`src/code-here/Minimal_v1.js`:

```js
'use strict';

function decide(s) {
  return { x: 0, y: 0, hit: 0 };
}
```

## Python

`src/code-here/Minimal_v1.py`:

```python
def decide(s):
    return {'x': 0, 'y': 0, 'hit': 0}
```

## 이 코드가 말해주는 것

- **파일에 필요한 유일한 조건**: 최상위에 `decide`라는 이름의 함수가 있으면
  됩니다. 클래스도, 별도 export도 필요 없습니다.
- **매개변수 이름은 자유**: `snapshot`이든 `s`이든 상관없습니다. 이 가이드에서는
  코드가 짧아지도록 `s`를 씁니다.
- **`{x: 0, y: 0, hit: 0}`은 "가만히 있음"의 명시적 표현**입니다. 어떤 값을
  돌려줄지 계산하다가 조건에 안 맞으면 이 기본값으로 돌아가는 패턴을
  자주 쓰게 됩니다.

## 지금 바로 해보기

1. 위 코드 중 하나를 `src/code-here/Minimal_v1.js` (또는 `.py`)로 저장
2. `npm start`가 이미 돌고 있다면 그대로, 아니면 실행
3. "Bot Setup" → LEFT를 **Bot**으로, 드롭다운에서 `Minimal v1 (JS)` 선택
   → RIGHT는 **AI**로 → **Apply**
4. 내장 AI가 서브를 넣고, 우리 Minimal 봇은 가만히 있다가 공에 맞습니다.

이 시점부터 `decide` 안에 로직을 하나씩 추가해가면 진짜 봇이 됩니다.
그 다음 단계 → [Positioning (수비형)](no-hit-positioning.md).
