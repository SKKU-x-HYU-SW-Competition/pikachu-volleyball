# 피카츄 배구 봇 대회 — 참가자 가이드

이 문서는 대회에 참가할 봇 코드를 준비하는 데 필요한 모든 것을 담고 있습니다.
차례대로 읽으면 됩니다.

## 대회가 뭘 시키는지

원작 [피카츄 배구](https://github.com/gorisanson/pikachu-volleyball)를 기반으로,
**참가자가 짠 프로그램(=봇)끼리 붙는** 대회입니다. 사람이 키보드로 조작하는 대신,
매 순간의 게임 상황(공의 위치·속도, 내 캐릭터 상태 등)을 스냅샷으로 받은
`decide(snapshot)` 함수가 조작을 대신합니다.

- **언어**: JavaScript 또는 Python (원하는 쪽 하나만 짜면 됩니다)
- **결과물**: 파일 한 개 — `TeamName_v1.js` 또는 `TeamName_v1.py`
- **함수 하나만 정의하면 됨**: `decide(snapshot) → { x, y, hit }`

## 최소 예시

```js
function decide(s) {
  // 공의 예상 낙하지점으로 걸어간다
  var dx = s.ball.expectedLandingPointX - s.self.x;
  var x = 0;
  if (Math.abs(dx) > 8) x = dx > 0 ? 1 : -1;
  return { x: x, y: 0, hit: 0 };
}
```

```python
def decide(s):
    dx = s['ball']['expectedLandingPointX'] - s['self']['x']
    x = 0
    if abs(dx) > 8:
        x = 1 if dx > 0 else -1
    return {'x': x, 'y': 0, 'hit': 0}
```

이게 봇의 전부입니다. 대회 규칙, 이 함수가 매 틱 어떻게 호출되는지, 스냅샷에
어떤 필드가 있는지는 다음 페이지들에서 하나씩 설명합니다.

## 이 가이드의 구조

| 페이지 | 뭘 얻어가나 |
|---|---|
| [환경 세팅 · 실행](getting-started.md) | 코드 짜고 로컬에서 바로 붙여보기까지 |
| [decide 함수와 스냅샷](api.md) | 스냅샷 필드 하나하나 뜻, 반환값 규칙 |
| [Python 봇 특이사항](python.md) | Python으로 짤 때만 알아야 할 것 |
| [예제 봇 3종](examples/minimal.md) | 뼈대 → 수비형 → 공격형, 왜 이렇게 짰는지 해설 |
| [대회 규칙](rules.md) | 파일명·크기·시간·언어 제약 |
| [자주 걸리는 함정](caveats.md) | Y축 방향, hit의 스매시 방향, 파이프라인 지연 등 |

## 준비물

- Node.js 18+ (테스트 환경 실행용)
- 에디터 아무거나
- (Python 봇의 경우) 로컬에 Python 설치는 **필요 없습니다** — 브라우저 안에서
  Pyodide로 돌아갑니다

바로 시작 → [환경 세팅 · 실행](getting-started.md)
