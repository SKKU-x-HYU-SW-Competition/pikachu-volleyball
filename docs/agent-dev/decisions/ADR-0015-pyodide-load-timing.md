# ADR-0015 — Pyodide 로드 타이밍 (Python 선택 시에만 지연 로드)

| | |
|---|---|
| 상태 | RESOLVED |
| 결정일 | 2026-08-05 |
| 결정자 | Claude Code (팀장 결재) |
| 반영 | `src/resources/js/bot/botWorkerPython.js`(예정), `src/resources/js/bot/testSetup.js`(예정 갱신) |

## 배경 (왜 막혔는지)

Pyodide 초기 로드에는 수 초가 걸림 (네트워크/디스크에서 wasm + 파이썬 표준 라이브러리 zip을 받고
인터프리터 부팅 + `pyodide.loadPackage('numpy')`까지). 어느 시점에 이 비용을 낼지 선택지:

- **A. 페이지 로드 시 무조건**: JS만 쓰는 참가자에게도 5~10초 지연.
- **B. Python 모드가 선택된 side가 생길 때만**: JS 유저는 무비용. Python 첫 Apply 시 로드.
- **C. Idle prefetch**: 백그라운드로 미리 다운받고, 참가자가 Python 선택 시 이미 준비되어 있으면
  즉시 사용. 아니면 B와 동일.

## 결정

**B(지연 로드)로 확정.**

동작:
- `PikaBotInput` 생성 시 `language: 'py'`이면 Pyodide Worker를 spawn — Worker의 `init` 핸들러가
  Pyodide를 로드 → `pyodide.loadPackage('numpy')` → 참가자 소스 실행 → `decide` 심볼 확보 순으로
  진행. 각 단계가 몇 초 걸릴 수 있음.
- 이 사이 Bot Setup 패널의 상태 줄에 `"Python 로딩 중..."` 표시 (기존 `onInitResult` 콜백 재사용,
  단 중간 진행 이벤트 추가). 성공 시 `"봇 코드 로드됨"`, 실패 시 `"에러: ..."`
  ([ADR-0017](ADR-0017-python-execution-failure.md)).
- 라운드는 `PikaBotInput`이 준비되지 않아도 시작됨 — 아직 `decide`가 없는 동안은 무입력
  ([ADR-0017](ADR-0017-python-execution-failure.md)의 D-002 폴백 그대로).

이유:
- JS만 쓰는 유저(원본 게임 조작 포함)에게 Pyodide 비용을 물리지 않음 — 지금 코드베이스에서 파이썬
  존재 자체를 모르는 유저도 계속 무비용.
- Python 유저에게도 "Apply → restart() → 인트로 → 메뉴 통과 → 다음 라운드 시작" 사이에 몇 초가
  자연스럽게 흐르므로([`testSetup.js:88-110`](../../../src/resources/js/bot/testSetup.js#L88-L110)의
  `syncWithGameState` 흐름 참고), 인터프리터 부팅이 그 안에 흡수될 여지가 있음. 완전히는 아니라도
  체감 지연이 완화됨.
- Idle prefetch(C)는 UX 이득이 있지만 (i) "언제 시작하고 언제 취소할지" 정책 표면이 늘고, (ii)
  네트워크/디스크 트래픽이 예측 불가하게 발생해 오프라인 대회장에서 CDN 요청이 실패하는 등 부작용의
  여지가 있음. 필요해지면 나중에 ADR로 별도 추가.

## 구현 메모

- Pyodide는 프로세스(=Worker) 하나당 한 번만 로드하면 됨. 참가자가 Apply를 다시 눌러 봇 소스만
  바꾸는 경우, 기존 Worker를 그대로 재사용하는 최적화 여지가 있으나 이번 결정 범위 밖 —
  `PikaBotInput.spawnWorker()`가 매번 새 Worker를 spawn하는 현재 동작을 유지하되, Pyodide 재로드
  비용이 실측에서 문제가 되면 후속 ADR로 재사용 로직 도입.
