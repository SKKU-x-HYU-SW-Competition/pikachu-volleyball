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
| 2026-08-10 | (커밋 전) | woochan (Claude Code) | ④ 스킬/에셋 | 에셋 해상도 스케일링 1단계 — `assets_path.js`에 `RATIO` 상수 도입(값 1), `main.js` 렌더러 크기와 `view.js` 전 좌표에 적용. RATIO=1이라 렌더링 결과는 기존과 동일하며, 배선 정확성만 검증(브라우저 육안 확인 완료). 텍스처 크기(`texture.width` 등), `anchor`, 좌우반전용 `scale.x`, 타일 개수는 의도적으로 제외. 후속: RATIO 값 확정 + 고해상도 에셋 제작 | DECISIONS.md ADR-0019 신규 등재(OPEN) |
| 2026-08-05 | (커밋 전) | 팀장 (Claude Code) | ⑤ 다국어 봇 | Phase 5 구현 1차 완료 (Python 러너). `TICK_FRAME_GROUP_SIZE=5` 반영, `pyodide@314.0.3` 설치 + `copy-webpack-plugin`으로 `dist/pyodide/`에 정적 복사, `botContract.js`에 `BOT_LANGUAGE` enum 추가, `botWorkerPython.js` 신설(Pyodide + numpy 자동 로드, 4단계 진행 phase 이벤트), `PikaBotInput`에 `language` 파라미터 + Worker URL 분기, `botWorker.js`도 phase 필드로 통일, `testSetup.js`에 언어 선택 UI + 진행 상태 문구, 3개 로케일 HTML/CSS 마크업 추가, `exampleBots.js`에 Python 추격형 예시 추가, `04-bot-writing-guide.md`에 Python 절/공통 실패 처리 절/타이밍 갱신 반영. `npm run verify` 통과. numpy wheel은 로컬 미포함 — 첫 로드 시 Pyodide CDN에서 fallback (offline 완전 지원은 후속 ADR) | 코드: `src/resources/js/bot/*`, `webpack.common.js`, `package.json`(pyodide 314.0.3 pin), `src/{en,ko,zh}/index.html`, `src/resources/style.css`. 문서: `docs/architecture/04-bot-writing-guide.md`, ADR-0014 numpy CDN fallback 메모 추가 |
| 2026-08-05 | (커밋 전) | 팀장 (Claude Code) | ⑤ 다국어 봇 | Phase 5(다국어 봇 지원) stub 확정 — Python 우선. 브라우저 내 WASM(Pyodide) 방식으로 확정, `TICK_FRAME_GROUP_SIZE`를 1→5로 상향(Pyodide 오버헤드 흡수 + 매프레임 결정으로 인한 승부 결착 어려움 완화). ADR 7건 신규 등재, CONTRACTS.md에 §1.4(언어별 진입점) 신설 및 §1.3/§2 갱신. 아직 코드 변경 없음(문서 단위 커밋) | CONTRACTS.md v0.5, DECISIONS.md ADR-0012~0018 신규 RESOLVED, ADR-0001 SUPERSEDED(→0016), PHASES.md Phase 5 신설 |
| 2026-07-24 | (커밋 전) | 팀장 (Claude Code) | ② 테스트 환경 | 사용자 제보 버그 수정: 좌우 둘 다 "봇 코드"로 설정하면 첫 경기 후 인트로/메뉴로 못 돌아옴(봇이 keyboardArray를 계속 점유해서 사람이 다음 경기를 내비게이션 못 함). "라운드 시작 시 1회 적용"을 "매 틱 게임 상태와 동기화하는 상시 워처"로 변경 — 경기 중(round/afterEndOfRound/beforeStartOfNextRound)에만 봇/AI 적용, 그 외(인트로/메뉴)엔 자동으로 실키보드 복원. Playwright로 restart() 후 키 입력으로 메뉴 진입 + 2차 라운드 봇 재적용까지 확인. 겸사겸사 결정 로그를 ADR 파일 방식(`docs/agent-dev/decisions/ADR-NNNN-*.md`)으로 분리, 브랜치 전략(main/develop/feature)+GitHub Issue 연동을 AGENTS.md/KICKOFF.md에 반영, 팀 온보딩 문서(`TEAM_ONBOARDING.md`) 작성 | DECISIONS.md ADR-0001~0011로 재구성, ADR-0011 신규 |
| 2026-07-19 | (커밋 전) | 팀장 (Claude Code) | ② 테스트 환경 | Phase 2 구현 완료: 좌/우 진영을 [키보드\|봇 코드\|기본 AI] 중 자유롭게 조합하는 Bot Setup 패널 추가 (`bot/testSetup.js`, `bot/nullInput.js`, `botInput.js`에 `onInitResult` 추가, `en/ko/zh index.html`+`style.css`). `devBotHook.js` 삭제. 구현 중 발견한 이중 리스너 등록 버그(D-010: config mutate + 중복 arm으로 봇 코드가 빈 채로 로드됨)를 계측 후 수정. Playwright로 키보드-봇/기본AI-봇/봇-봇 세 조합과 새로고침 후 설정 자동 재적용까지 실제 브라우저에서 검증 | DECISIONS.md D-010 RESOLVED, PHASES.md Phase 2 완료 |
| 2026-07-11 | (커밋 전) | 팀장 (Claude Code) | ① 입력 구조 | Phase 1 구현 완료: `bot/botContract.js`(스냅샷 빌더/상수), `bot/botWorker.js`(Worker 실행기), `bot/botInput.js`(`PikaBotInput`), 임시 dev 와이어링 `bot/devBotHook.js` + `main.js` 연결. 구현 중 D-009(메인 스레드가 Worker 응답을 그 틱 안에 동기 대기 불가) 발견·반영. `npm run lint`/`build` 통과, Playwright로 실제 브라우저에서 `?bot=right` 기동 → 봇이 자율적으로 공을 쫓아가 점프+파워히트(state 0→1→2)하는 것을 스크린샷/상태값으로 확인 | CONTRACTS.md v0.4, DECISIONS.md D-009 RESOLVED(확인 요망), PHASES.md Phase 1 완료 |
| 2026-07-10 | (커밋 전) | 팀장 (Claude Code) | - | D-004(제출 인프라: 이메일+수동 로드 가정) / D-005(현재 스레드 기준 오너십: 팀장+Claude Code) 결정 및 반영. DECISIONS.md OPEN 항목 소진, AGENTS.md §4 담당자 표 채움 | DECISIONS.md D-004/D-005 RESOLVED, AGENTS.md §4 |
| 2026-07-07 | (커밋 전) | Claude Code (사용자 승인) | ① 입력 구조 | D-001(틱 그룹핑=1 확정)/D-002(타임아웃·오반환 시 무입력)/D-003(Worker 격리) 결정 및 반영. CONTRACTS.md에 §1.3(실행 모델) 신설 | CONTRACTS.md v0.3, DECISIONS.md D-001/D-002/D-003 RESOLVED |
| 2026-07-07 | (커밋 전) | YoonJinJung (Claude Code) | ① 입력 구조 | 브레인스토밍한 봇 프로토콜을 엔진 코드와 대조 검토. 출력을 4-bit(left/right/jump/spike)→엔진과 1:1인 3필드(x/y/hit)로 변경, 좌표계는 원본 정수 픽셀 그대로 확정, `expectedLandingPointX` 노출 확정, 세트제 미도입 확정 | CONTRACTS.md v0.2, DECISIONS.md D-006/D-007/D-008 RESOLVED |
| 2026-07-07 | (초기 세팅, 커밋 전) | YoonJinJung (Claude Code) | - | agent 개발 환경 문서 인프라 구성 (CLAUDE.md/AGENTS.md 이중화, CONTRACTS/PHASES/KICKOFF/VERIFY/TRACKER/DECISIONS) | CONTRACTS.md v0.1 |
