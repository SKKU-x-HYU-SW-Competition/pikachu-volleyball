# Python 봇 특이사항

Python으로 봇을 짤 때만 해당하는 내용입니다. JavaScript 봇은 이 페이지를
건너뛰어도 됩니다.

## 실행 환경: Pyodide (브라우저 안의 CPython)

Python 봇은 **여러분 컴퓨터의 Python이 아니라** 브라우저 안에서 WebAssembly로
돌아가는 [Pyodide](https://pyodide.org/) 위에서 실행됩니다. 참가자가 로컬에
Python을 설치할 필요가 없다는 뜻입니다.

- 실행되는 Python 버전은 Pyodide 314.0.3의 CPython 3.x
- 모든 실행은 여러분의 브라우저 안에서 (로컬), 네트워크로 어디에도 안 보냄

## `snapshot`은 파이썬 dict

JavaScript 예제와 필드 이름·값은 완전 동일하지만, Python에선 `dict` 접근
문법을 씁니다:

```python
def decide(s):
    # OK
    ball_x = s['ball']['x']
    my_score = s['meta']['score']['self']

    # NG (JS 문법)
    # ball_x = s.ball.x   ← AttributeError
```

`{'x': ..., 'y': ..., 'hit': ...}`도 반드시 **dict**로 반환하세요. `tuple`
`list` `dataclass` 등은 인식되지 않고, 그 틱은 무입력 처리됩니다.

## 사용 가능한 라이브러리

### 즉시 import 가능

- **Python 3 표준 라이브러리 전체**: `math`, `random`, `heapq`, `collections`,
  `itertools`, `functools`, `statistics`, `bisect`, `dataclasses`, ...
- **numpy** (`import numpy as np`)

### 사용 불가

- `scipy`, `pandas`, `scikit-learn`, `torch`, `tensorflow` 등 서드파티
- 파일 I/O (`open(...)`), 네트워크 (`requests`, `urllib`) — 어차피 접근할 파일이
  없고, 매치 도중 외부 요청은 시간 예산을 넘김
- `subprocess`, `os.system` — Pyodide 환경에선 의미 없음

허용 안 된 모듈을 `import`하면 **초기화 실패**로 처리되고, 봇 설정 창의
상태 줄에 에러가 뜹니다. 그 봇으로 매치가 진행되지 못합니다.

## 초기화 지연: 첫 로드는 몇 초 걸립니다

Python 봇을 선택하고 **적용(재시작)**을 누르면 그때부터:

1. Pyodide 런타임 다운로드·초기화 (몇 초)
2. numpy 로딩 (짧게)
3. 여러분의 파일 소스 실행 (즉시)
4. 첫 라운드 시작

봇 설정 패널에 "환경 세팅 중..." 모달이 뜨고, 로딩이 끝나면 자동으로
사라지면서 게임이 재시작됩니다. **JS 봇은 이 지연이 없습니다.**

이 로딩은 **같은 봇 파일에 대해서는 페이지가 살아있는 동안 한 번만** 합니다.
적용(재시작)을 다시 눌러도, 봇 파일이 그대로면 재로딩하지 않습니다.

## `print`는 브라우저 콘솔로

```python
print("현재 공 위치:", s['ball']['x'], s['ball']['y'])
```

이 출력은 `F12` → Console 탭에서 볼 수 있습니다. JS의 `console.log`와 완전
같은 위치입니다. **매 틱 print하지 마세요** — 브라우저 콘솔이 폭발합니다.
Example 봇처럼 카운터로 몇 틱마다만 찍는 게 좋습니다:

```python
tick_counter = 0
LOG_EVERY_N = 20

def decide(s):
    global tick_counter
    tick_counter += 1
    if tick_counter % LOG_EVERY_N == 0:
        print("tick", s['tick'], "ball", s['ball']['x'], s['ball']['y'])
    # ...
```

## 흔한 실수 모음

| 증상 | 원인 | 해결 |
|---|---|---|
| 적용(재시작) 눌러도 상태 줄이 "에러: SyntaxError ..." | 파이썬 문법 오류 | 파일을 로컬에서 `python -m py_compile` 해보거나, 에디터의 문법 체크 활용 |
| "에러: name 'decide' is not defined" | 최상위에 `decide` 함수가 없음, 또는 오타 | 파일 최상위에 `def decide(s):`로 정의됐는지 확인 |
| "에러: No module named 'scipy'" | 허용 안 된 서드파티 import | 표준 라이브러리 + numpy만 사용 |
| 봇이 계속 가만히 있음 | `decide`가 dict 아닌 값 반환, 또는 예외 발생 중 | 콘솔에서 예외 메시지 확인 (`F12` → Console). `try/except`로 감싸서 print 해보기 |
| 매치가 이상하게 느림 | 매 tick 무거운 연산 | `decide` 밖으로 뺄 수 있는 계산은 최상위(파일 로드 시점)로 옮기기 |

## 완성된 Python 봇 예시

가장 간단한 형태부터 시작해서 감을 잡고 싶다면 → [Minimal 예제](examples/minimal.md)의
Python 버전.
