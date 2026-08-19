# 환경 세팅 · 실행

봇을 짜서 로컬에서 붙여보는 데까지 필요한 작업만 정리합니다. 5분이면 됩니다.

## 1. 저장소 받기

```bash
git clone <대회_저장소_URL>
cd pikachu-volleyball
npm install
```

`npm install`은 처음 한 번만 하면 됩니다. Python 봇을 짜더라도 로컬에 Python을
설치할 필요는 없습니다 — 브라우저 안에서 Pyodide로 실행됩니다.

## 2. 봇 파일 넣기

`src/code-here/` 폴더에 파일 하나만 만들면 됩니다.

```
src/code-here/
├── Example_v1.js      ← 처음부터 들어있는 예제 (JS)
├── Example_v1.py      ← 처음부터 들어있는 예제 (Python)
└── MyTeam_v1.js       ← 여러분이 새로 만든 파일
```

### 파일명 규칙

```
<팀명>_v<버전>.<js|py>
```

- 마지막 `_v` 앞이 팀명, 뒤가 버전으로 파싱됩니다. 팀명 안에 `_`가 들어가도 괜찮습니다 (`Team_A_v1.js` → 팀 `Team_A`, 버전 `1`)
- 확장자로 언어를 자동 판별합니다 — `.js`면 JavaScript, `.py`면 Python
- 버전은 문자열이라 `1`, `1.2`, `20260814` 등 자유롭게

**동일한 팀명 + 버전 + 언어면 UI 드롭다운에 하나로만 보입니다.** 대회 당일 코드
수정 후 재제출할 땐 버전 번호를 올려서 이전 버전과 구분하는 걸 권장합니다.

### 파일 내용의 최소 형태

**JavaScript**:
```js
function decide(snapshot) {
  return { x: 0, y: 0, hit: 0 };
}
```

**Python**:
```python
def decide(snapshot):
    return {'x': 0, 'y': 0, 'hit': 0}
```

파일 최상위에 `decide`라는 이름의 함수가 있으면 됩니다. 다른 헬퍼 함수·상수는
`decide` 위에 자유롭게 정의해도 되고, 파일 최상위에 있는 변수는 매 틱 사이에
그 값이 유지됩니다 (자세한 건 [API 페이지](api.md)의 "봇 실행 모델" 참고).

## 3. 게임 실행

```bash
npm start
```

브라우저에서 `http://localhost:8080`이 열립니다.

> `src/code-here/`에 파일을 추가·수정하면 dev 서버가 자동으로 재빌드해서 반영합니다.
> 서버를 재시작할 필요는 없습니다.

## 4. 봇 설정 창으로 붙이기

게임 화면 상단 메뉴바의 **"봇 설정"** 버튼을 누르면 패널이 열립니다.

```
┌─────────────────────────────────────────┐
│ LEFT               RIGHT                │
│ ○ Keyboard         ● Keyboard           │
│ ● Bot              ○ Bot                │
│ ○ AI               ○ AI                 │
│ [ MyTeam v1 (JS) ▼ ]  [ -- 봇 선택 -- ▼ ] │
│ 상태: 봇 코드 로드됨   상태:              │
│                                         │
│          [ 적용(재시작) ]                │
└─────────────────────────────────────────┘
```

각 side(왼쪽/오른쪽)마다 **세 가지 모드**를 고를 수 있습니다:

- **Keyboard**: 사람이 키보드로 조작 (원작 그대로)
- **Bot**: 여러분이 짠 봇 코드. 오른쪽 드롭다운에서 `src/code-here/`의 파일 하나를 선택
- **AI**: 원작에 내장된 컴퓨터 AI

설정을 바꾼 뒤 **"적용(재시작)"** 버튼을 누르면 그 설정으로 매치가
재시작됩니다.

## 5. 키보드 조작 (Keyboard 모드일 때)

혹시 "Keyboard" 모드로 사람이 붙어야 할 때 참고:

| | 좌 | 우 | 점프(위) | 아래 | 파워히트 |
|---|---|---|---|---|---|
| LEFT (Player 1) | D | G | R | F | Z |
| RIGHT (Player 2) | ← | → | ↑ | ↓ | Enter |

## 6. 다음 단계

- 봇이 어떤 정보를 받고 어떻게 답해야 하는지: [decide 함수와 스냅샷](api.md)
- Python 봇 특유의 주의사항: [Python 봇 특이사항](python.md)
- 예제 3종 해설: [Minimal](examples/minimal.md) → [Positioning](examples/no-hit-positioning.md) → [Power Hit](examples/power-hit.md)
