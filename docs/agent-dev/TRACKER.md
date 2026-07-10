# TRACKER.md — 결과 트래커

CI가 없으므로, 이 로그가 "누가 뭘 했는지"를 공유하는 유일한 장치입니다. **커밋할 때마다** (최소한
세션을 끝낼 때) 아래 표에 한 줄을 추가하세요. 정기 회의는 이 표를 보고 시작합니다 — 여기 없는
변경사항은 회의에서 논의되지 않을 수 있습니다.

작성 규칙:
- 최신 항목이 위로 오게 추가하세요 (역시간순).
- `요약`은 diff를 안 봐도 무슨 변경인지 알 수 있게 한 줄로 (커밋 메시지 재탕이어도 무방).
- `관련 문서`에는 해당 작업으로 갱신된 CONTRACTS.md 버전이나 새로 등재/해소된 DECISIONS.md 항목 ID를 적으세요.

| 날짜 | 커밋 해시 | 작성자 (도구) | Phase | 요약 | 관련 문서 |
|---|---|---|---|---|---|
| 2026-07-10 | (커밋 전) | 팀장 (Claude Code) | - | D-004(제출 인프라: 이메일+수동 로드 가정) / D-005(현재 스레드 기준 오너십: 팀장+Claude Code) 결정 및 반영. DECISIONS.md OPEN 항목 소진, AGENTS.md §4 담당자 표 채움 | DECISIONS.md D-004/D-005 RESOLVED, AGENTS.md §4 |
| 2026-07-07 | (커밋 전) | Claude Code (사용자 승인) | ① 입력 구조 | D-001(틱 그룹핑=1 확정)/D-002(타임아웃·오반환 시 무입력)/D-003(Worker 격리) 결정 및 반영. CONTRACTS.md에 §1.3(실행 모델) 신설 | CONTRACTS.md v0.3, DECISIONS.md D-001/D-002/D-003 RESOLVED |
| 2026-07-07 | (커밋 전) | YoonJinJung (Claude Code) | ① 입력 구조 | 브레인스토밍한 봇 프로토콜을 엔진 코드와 대조 검토. 출력을 4-bit(left/right/jump/spike)→엔진과 1:1인 3필드(x/y/hit)로 변경, 좌표계는 원본 정수 픽셀 그대로 확정, `expectedLandingPointX` 노출 확정, 세트제 미도입 확정 | CONTRACTS.md v0.2, DECISIONS.md D-006/D-007/D-008 RESOLVED |
| 2026-07-07 | (초기 세팅, 커밋 전) | YoonJinJung (Claude Code) | - | agent 개발 환경 문서 인프라 구성 (CLAUDE.md/AGENTS.md 이중화, CONTRACTS/PHASES/KICKOFF/VERIFY/TRACKER/DECISIONS) | CONTRACTS.md v0.1 |
