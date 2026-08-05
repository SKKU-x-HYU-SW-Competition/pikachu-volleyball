# ADR-0013 — Python 봇 진입점 시그니처

| | |
|---|---|
| 상태 | RESOLVED |
| 결정일 | 2026-08-05 |
| 결정자 | Claude Code (팀장 결재) |
| 반영 | [CONTRACTS.md](../CONTRACTS.md) §1.4(신설), `src/resources/js/bot/botWorkerPython.js`(예정), `src/resources/js/bot/examplePythonBots.js`(예정) |

## 배경 (왜 막혔는지)

[ADR-0012](ADR-0012-multi-language-bot-support.md)로 Python 지원이 확정된 뒤, 참가자가 실제로 어떤
형태로 `decide` 함수를 정의해야 하는지 결정 필요. 선택지:

1. `def decide(snapshot: dict) -> dict:` — JS `function decide(snapshot)`와 대칭. snapshot은 dict.
2. typed class 강제 (pydantic 등) — 필드명 오타 등을 조기 검출.
3. keyword arguments 전개 (`def decide(*, tick, side, self, opp, ball, meta, config):`) — 파이썬다움.

## 결정

**1번(`def decide(snapshot: dict) -> dict:`)으로 확정.** JS와 완전 대칭.

- 입력: [CONTRACTS.md §1.2](../CONTRACTS.md) 스냅샷을 Pyodide의 `pyodide.ffi.to_py()`로 자동 변환한 dict.
  중첩된 필드도 그대로 dict/list로 접근 (`snapshot['self']['x']`, `snapshot['ball']['expectedLandingPointX']` 등).
- 출력: `{'x': -1|0|1, 'y': -1|0|1, 'hit': 0|1}` dict. 검증은 기존 `isValidBotAction()`
  ([`bot/botContract.js:60-67`](../../../src/resources/js/bot/botContract.js#L60-L67)) 규칙 그대로 재사용
  (Python 반환값을 Pyodide가 JS 객체로 다시 변환한 뒤 검증).

이유:
- CONTRACTS.md §1.2 스냅샷 스키마가 이미 JSON 호환 dict 구조. Pyodide의 `to_py()`가 무손실로
  변환해주므로 추가 매핑 계층이 불필요.
- typed class(pydantic 등)를 강제하면 Pyodide 기본 인터프리터 밖 의존이 붙어 번들이 커지고
  ([ADR-0014](ADR-0014-pyodide-distribution.md)와 상충), "익숙한 언어로 짜기"라는 대회 취지와도 어긋남.
- keyword arguments 전개(3번)는 파이썬답지만, JS와 스냅샷 필드 이름을 다르게 관리해야 할 여지가
  생기고 JS `snapshot.self.x` ↔ Python `self['x']`처럼 두 언어 코드를 나란히 놓고 비교할 때 대응이
  덜 명확해짐. 특히 예시 봇을 언어별로 포팅해 참가자에게 나란히 보여줄 때 대칭성이 중요.
- 실패 처리 규칙([ADR-0017](ADR-0017-python-execution-failure.md))도 반환 dict 형태를 그대로 검증하는
  기존 로직을 재활용할 수 있어 코드 경로가 하나로 단순해짐.
