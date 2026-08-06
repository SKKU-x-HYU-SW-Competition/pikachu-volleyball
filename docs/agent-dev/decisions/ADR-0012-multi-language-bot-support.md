# ADR-0012 — 다국어 봇 지원 방식 (브라우저 내 WASM)

| | |
|---|---|
| 상태 | RESOLVED |
| 결정일 | 2026-08-05 |
| 결정자 | Claude Code (팀장 결재) |
| 반영 | [CONTRACTS.md](../CONTRACTS.md) §1.3, [PHASES.md](../PHASES.md) Phase 5, `src/resources/js/bot/botWorkerPython.js`(예정) |

## 배경 (왜 막혔는지)

Phase 1~2에서 확정된 봇 구조는 Web Worker 안에서 JS `new Function()`으로 참가자 소스를 실행함
([`bot/botWorker.js`](../../../src/resources/js/bot/botWorker.js)). 참가자가 익숙한 언어(Python,
C/C++ 등)로도 봇을 짤 수 있게 확장하려는데, 실행 위치가 두 계열로 갈림:

- **A. 브라우저 내부 WASM**: Python은 Pyodide(WebAssembly로 포팅된 CPython), C/C++는 참가자가
  Emscripten으로 컴파일한 `.wasm`을 제출. 지금 Worker 자리에 언어별 러너를 꽂음.
- **B. 브라우저 외부 sidecar**: 로컬 네이티브 프로세스가 참가자 코드를 subprocess로 실행하고
  WebSocket으로 브라우저와 스냅샷/액션 교환.

## 결정

**A(브라우저 내부 WASM)로 확정.** sidecar 방식(B)은 배제.

이유:
- 현재 아키텍처(Worker 격리, `postMessage` 프로토콜, 정적 배포)를 **그대로 유지**. 확장 지점은
  "이 Worker 안에서 뭘 실행하는가" 하나뿐이며, `PikaBotInput`
  ([`bot/botInput.js:84-86`](../../../src/resources/js/bot/botInput.js#L84-L86))의 Worker URL만 언어별로
  분기하면 됨. 프로토콜(§1.2 스냅샷, §1.1 액션)은 언어와 무관.
- 격리 모델([ADR-0003](ADR-0003-bot-execution-sandboxing.md))이 언어와 무관하게 동일하게 적용됨 —
  Python도 Worker 안에서 돌아 무한루프/과부하가 메인 스레드를 멈추지 못함.
- 중계 PC에 별도 런타임(Python 인터프리터, gcc 등) 설치·관리 불필요. 대회 부스 세팅이 여전히 웹
  정적 파일 하나 배포하는 수준으로 유지됨.
- sidecar 방식(B)은 배포/설치/네트워크 격리 문제를 새로 만들고, 그에 대한 이점(참가자가 자기 언어로
  로컬 디버깅)은 브라우저 개발자 도구 Worker 콘솔로 충분히 대체 가능하다고 판단.

트레이드오프 (감수):
- C/C++ 참가자는 Emscripten 툴체인 사용법을 익혀야 함. 이번 브랜치(`python`)에서는 Python만 우선
  구현하고, C/C++ 지원은 별도 브랜치/ADR로 뒤에 진행.
- Python은 첫 로드 시 Pyodide 다운로드(수 MB)가 필요 — [ADR-0014](ADR-0014-pyodide-distribution.md)
  (정적 복사)와 [ADR-0015](ADR-0015-pyodide-load-timing.md) (지연 로드)로 완화.
