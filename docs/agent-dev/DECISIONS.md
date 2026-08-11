# DECISIONS.md — 결정 인덱스 (ADR)

스펙이 불확실할 때 **그 자리에서 임의로 정하지 않기 위한 장치**입니다. 결정 하나당 파일 하나
(`docs/agent-dev/decisions/ADR-NNNN-slug.md`)로 관리합니다 — 여러 명이 동시에 작업할 때 한 파일
끝부분에 계속 append하면 merge conflict가 잦기 때문에, 결정마다 별도 파일로 분리했습니다
([ADR-0010](decisions/ADR-0010-bot-setup-double-listener-bug.md)까지는 원래 한 파일에 있던 걸
이 구조로 옮긴 것). 이 파일은 무엇이 있는지 훑어보기 위한 **인덱스**일 뿐, 실제 내용은 각 ADR
파일에 있습니다.

## 새 결정을 추가하려면

1. 최소한의 stub(임시 기본값)으로 막아서 작업을 계속하고,
2. `docs/agent-dev/decisions/ADR-NNNN-slug.md` 새 파일을 만드세요. `NNNN`은 아래 표의 마지막 번호
   + 1, 4자리로 0-패딩(`0011`). **다른 브랜치에서 동시에 같은 번호를 썼다면** 나중에 merge하는 쪽이
   자기 번호를 다음 빈 번호로 바꾸세요 (드물게만 발생하고 고치기 쉬우므로 번호 예약 절차 같은 건
   두지 않습니다).
   - 상태가 아직 OPEN이라도(임시 stub만 있고 확정 전이라도) 파일은 만들어서 등록하세요 — "왜 막혔는지"만 적어도 됩니다.
3. 실제로 결정되면 파일 상단 표의 `상태`를 `RESOLVED`로 바꾸고 `결정` 섹션을 채우세요 (파일을
   지우지 마세요 — 왜 그렇게 정했는지가 나중에 중요해집니다).
4. 아래 표에 한 줄 추가하세요.

**개인이 임의로 RESOLVED 처리하지 말고, 정기 회의에서 결정한 뒤 반영하세요.**

각 ADR 파일 상단에 상태/결정일/결정자/반영 위치를 적는 작은 표를 두는 형식으로 통일합니다 —
기존 ADR 파일을 참고하세요.

---

## 목록

| ID | 제목 | 상태 |
|---|---|---|
| [ADR-0001](decisions/ADR-0001-tick-frame-group-size.md) | 틱 길이 (몇 프레임 = 1 틱?) | SUPERSEDED (→ ADR-0016) |
| [ADR-0002](decisions/ADR-0002-timeout-and-invalid-response.md) | 틱 시간초과(또는 잘못된 반환값) 시 처리 | RESOLVED |
| [ADR-0003](decisions/ADR-0003-bot-execution-sandboxing.md) | 봇 코드 실행 방식 (샌드박싱 필요 여부) | RESOLVED |
| [ADR-0004](decisions/ADR-0004-submission-infra.md) | 제출 인프라 | RESOLVED |
| [ADR-0005](decisions/ADR-0005-team-roster-ownership.md) | 팀 로스터 / 트랙 오너십 | RESOLVED (부분) |
| [ADR-0006](decisions/ADR-0006-expose-expected-landing-point.md) | `expectedLandingPointX`를 스냅샷에 노출할지 | RESOLVED |
| [ADR-0007](decisions/ADR-0007-coordinate-system.md) | 좌표 변환 방식 | RESOLVED |
| [ADR-0008](decisions/ADR-0008-no-set-system.md) | 세트제 도입 여부 | RESOLVED |
| [ADR-0009](decisions/ADR-0009-worker-async-latency.md) | 메인 스레드가 봇 Worker 응답을 그 틱 안에 동기적으로 못 받는 문제 | RESOLVED (확인 요망) |
| [ADR-0010](decisions/ADR-0010-bot-setup-double-listener-bug.md) | Bot Setup 패널 이중 리스너 버그 | RESOLVED |
| [ADR-0011](decisions/ADR-0011-bot-setup-menu-navigation.md) | Bot Setup: 봇이 인트로/메뉴 내비게이션을 막는 버그 | RESOLVED |
| [ADR-0012](decisions/ADR-0012-multi-language-bot-support.md) | 다국어 봇 지원 방식 (브라우저 내 WASM) | RESOLVED |
| [ADR-0013](decisions/ADR-0013-python-decide-signature.md) | Python 봇 진입점 시그니처 | RESOLVED |
| [ADR-0014](decisions/ADR-0014-pyodide-distribution.md) | Pyodide 배포 방식 (정적 복사) | RESOLVED |
| [ADR-0015](decisions/ADR-0015-pyodide-load-timing.md) | Pyodide 로드 타이밍 (Python 선택 시에만 지연 로드) | RESOLVED |
| [ADR-0016](decisions/ADR-0016-tick-frame-group-size-raised.md) | TICK_FRAME_GROUP_SIZE 상향 (1 → 3) | RESOLVED |
| [ADR-0017](decisions/ADR-0017-python-execution-failure.md) | Python 봇 실행 실패 처리 (D-002 확장) | RESOLVED |
| [ADR-0018](decisions/ADR-0018-python-library-scope.md) | Python 봇 사용 가능 라이브러리 범위 (표준 + numpy) | RESOLVED |
| [ADR-0019](decisions/ADR-0019-asset-resolution-ratio.md) | 에셋 해상도 스케일링 배율 (RATIO) | RESOLVED |
| [ADR-0020](decisions/ADR-0020-gauge-system.md) | 게이지 시스템 (스킬 발동 자원) | PARTIAL (충전 규칙만 확정) |
| [ADR-0021](decisions/ADR-0021-claw-skill.md) | 첫 번째 스킬 「claw」 (범위 예고 → 발톱 → 기절) | PARTIAL (콘셉트·조준 규칙·판정 축 확정 / 수치는 stub) |
| [ADR-0022](decisions/ADR-0022-bot-skill-action-field.md) | 봇 액션에 스킬 발동 필드 `skillX` 추가 | RESOLVED (회의 승인 전 / 스냅샷 확장은 별도) |
| [ADR-0023](decisions/ADR-0023-snapshot-skill-state.md) | 스냅샷에 게이지·claw 예고·튜닝 상수 노출 | RESOLVED (회의 승인 전) |
| [ADR-0024](decisions/ADR-0024-rally-boundary-for-skills.md) | 랠리 경계 판정 정정 (착지 후에도 게이지가 차던 버그) | RESOLVED (회의 승인 전) |
| [ADR-0025](decisions/ADR-0025-gauge-cost-vs-charge-rate.md) | 게이지 충전 속도 대비 claw 비용 (봇 대전에서 스킬이 거의 안 나옴) | **OPEN — 회의 안건** |
| [ADR-0026](decisions/ADR-0026-touch-limit-vs-smash-logic.md) | 5회 터치 제한과 원작 AI의 "확실할 때만 스매시" 로직 충돌 | PARTIAL (가이드 문서화 완료 / 규칙 수치는 회의 안건) |
| [ADR-0027](decisions/ADR-0027-touch-limit-rally-gate.md) | 터치 제한도 `isRallyLive()`를 쓰도록 통일 | **OPEN (미착수)** |

*(ADR-0020은 충전 규칙만 확정이고 스킬 효과·소모량·봇 프로토콜 확장·사람 발동키는 아직 OPEN입니다 —
회의 안건. 원래 `feature/5-gauge-system`에서 ADR-0019로 등재됐다가, 같은 번호를 RATIO 결정이 먼저
`develop`에 머지하며 점유해서 절차대로 0020으로 옮긴 것입니다.
새로 발견되는 미확정 사항은 위 절차대로 새 ADR 파일을 만들고 여기 추가하세요.)*
