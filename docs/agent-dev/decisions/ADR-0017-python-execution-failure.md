# ADR-0017 — Python 봇 실행 실패 처리 (D-002 확장)

| | |
|---|---|
| 상태 | RESOLVED |
| 결정일 | 2026-08-05 |
| 결정자 | Claude Code (팀장 결재) |
| 반영 | `src/resources/js/bot/botWorkerPython.js`(예정), [CONTRACTS.md](../CONTRACTS.md) §1.4(신설) |

## 배경 (왜 막혔는지)

JS 봇의 실패 처리는 [ADR-0002](ADR-0002-timeout-and-invalid-response.md) (D-002)로 확정: 매 틱
타임아웃/잘못된 반환 → 무입력, 초기화 실패(문법 오류/`decide` 없음)는 `onInitResult`로 UI에 에러
표시. Python은 새 실패 모드가 여럿 추가됨:

- Pyodide 자체 로드 실패 (네트워크/디스크/wasm 로딩 오류)
- 파이썬 문법 오류 (`SyntaxError`)
- `decide` 함수 미정의
- 허용 목록 밖 `import` 실패 (`ModuleNotFoundError`)
- 매 틱 `decide` 내부 예외 (0으로 나누기 등)
- 매 틱 반환값이 dict가 아니거나 필드가 없거나 범위 밖

## 결정

**D-002를 확장.** 실패를 두 단계로 분류하고 각각 처리 규칙을 정함:

### 초기화 단계 실패
Pyodide 로드/`loadPackage('numpy')`/문법 오류/`decide` 미정의/import 실패 — **`onInitResult`로 UI
상태 줄에 에러 표시**하고 그 Worker는 non-functional 상태 유지. JS 봇의 초기화 실패와 같은 UX
표면. Bot Setup 패널의 상태 문구:

- `"Python 로딩 중..."` (Pyodide 부팅 중)
- `"Python 준비 중... (numpy 로딩)"` (loadPackage 진행 중)
- `"봇 코드 로드됨"` (성공)
- `"에러: SyntaxError: ..."` / `"에러: ModuleNotFoundError: No module named 'X'"` (실패)

### 매 틱 단계 실패
`decide` 내부 예외/타임아웃/반환 dict 검증 실패 — **그 틱만 무입력**(D-002 그대로). 로그는 Worker
콘솔로만 출력, UI에는 노출하지 않음(JS와 동일 정책). `BOT_RESPONSE_TIMEOUT_MS`는 [ADR-0016](ADR-0016-tick-frame-group-size-raised.md)에
따라 600ms까지 늘어나 있음 — Pyodide 첫 콜의 워밍업 흡수용.

이유:
- JS와 실패 UX를 통일하면 참가자가 언어를 바꿔도 "빨간 에러 메시지 = 초기화 실패, 조용히 잘못
  움직이는 봇 = 매 틱 예외"라는 디버깅 감각이 그대로 이전됨.
- 초기화/틱 단계를 나눈 이유: 초기화 실패는 봇 로직 자체가 못 돌아가는 상태라 UI로 즉시 알려야
  참가자가 고칠 수 있고, 매 틱 실패는 한 틱만 무입력 처리하면 게임이 계속 굴러가는 데 지장 없음.
- Pyodide 로드 실패는 초기화 단계에서만 발생 가능하므로 매 틱 폴백 규칙과 자연스럽게 분리됨.
- `MAX_CONSECUTIVE_TIMEOUTS_BEFORE_RESTART`([`botContract.js:50`](../../../src/resources/js/bot/botContract.js#L50))
  로직도 재사용 — 매 틱 예외/타임아웃이 연속 15회 쌓이면 Worker 강제 재시작. 다만 Python은 재시작
  시 Pyodide 부팅부터 다시 해야 해서 몇 초 걸림 — 이건 감수 (참가자 봇이 15연속 죽는 상황은 정상
  경기가 아니므로).

## 구현 메모

- `onInitResult` 콜백의 시그니처를 확장할 필요 있음: 현재 `{ ok, error }` 두 필드지만, 진행 중
  상태("Pyodide 로딩", "numpy 로딩")를 표현하려면 `{ phase, ok?, error? }` 같은 형태 검토.
  기존 JS 러너는 `phase: 'ready'`만 쓰도록 하위 호환 유지.
