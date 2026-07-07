# AGENTS.md — 이 저장소의 진짜 개발 가이드

> 이 파일은 이 저장소에서 작업하는 **모든 사람과 모든 에이전트 도구(Claude Code, Codex CLI 등)의
> 단일 진실 소스(SOR)** 입니다. `CLAUDE.md`는 이 파일로의 리다이렉트일 뿐이며, 도구마다 다른 규칙을
> 두지 않기 위해 이 구조를 씁니다. 새 세션을 시작할 때는 [docs/agent-dev/KICKOFF.md](docs/agent-dev/KICKOFF.md)의
> 킥오프 프롬프트를 먼저 사용하세요.

## 1. 프로젝트가 뭔지

원작 [피카츄 배구](README.ko.md)(PixiJS 기반, 원작자 허락받고 포크)를 SW 교류전 대회용으로
개조하는 프로젝트입니다. 대회 종목은 "룰 기반 또는 학습 기반 게임 에이전트끼리의 대결"이며,
참가자는 사전에 공개된 규칙으로 에이전트 코드를 짜오고, 현장에서 새 스킬이 공개되면 그 자리에서
코드를 수정해 대결합니다.

이 저장소는 **대회 인프라(게임 자체 + 테스트 환경 + 제출/중계 도구)를 만드는 운영진 저장소**입니다.
참가자에게 배포되는 저장소가 아니라는 점에 유의하세요 (참가자 배포판/규칙 문서는 별도 산출물이며,
아직 이 저장소 안에 확정되어 있지 않습니다 — [DECISIONS.md](docs/agent-dev/DECISIONS.md) 참고).

## 2. 원작 게임 구조 요약 (수정 전 반드시 이해할 것)

MVC 패턴이며 세 축:

- **Model (물리 엔진)**: [`src/resources/js/physics.js`](src/resources/js/physics.js) — 공/플레이어 위치 계산 + 기본 탑재 컴퓨터 AI(`letComputerDecideUserInput`)도 같은 파일에 있음.
- **View**: [`src/resources/js/view.js`](src/resources/js/view.js), [`cloud_and_wave.js`](src/resources/js/cloud_and_wave.js) — PixiJS 렌더링.
- **Controller**: [`src/resources/js/pikavolley.js`](src/resources/js/pikavolley.js) — 게임 상태 머신 + 게임 루프.

### 게임 루프 / 틱 (agent 입력 구조 개편 시 핵심)

- [`main.js:154-161`](src/resources/js/main.js#L154-L161)에서 PixiJS `Ticker`가 `maxFPS = pikaVolley.normalFPS`로
  매 틱마다 `pikaVolley.gameLoop()`을 호출합니다.
- `normalFPS = 25` → **1 tick = 40ms** (골 직후 6프레임만 `slowMotionFPS = 5`로 느려짐 —
  [`pikavolley.js:53-63`](src/resources/js/pikavolley.js#L53-L63)).
- [`gameLoop()`](src/resources/js/pikavolley.js#L120-L140)은 매 틱마다
  `keyboardArray[0].getInput()`, `keyboardArray[1].getInput()`을 호출해 그 틱의 입력을 "고정"한 뒤
  `this.state()`(대부분 `round()`)를 실행하고, 거기서 `physics.runEngineForNextFrame(this.keyboardArray)`가
  두 입력을 소비합니다.
- 입력 인터페이스는 [`PikaUserInput`](src/resources/js/physics.js#L102-L111) 클래스로,
  필드는 `xDirection(-1|0|1)`, `yDirection(-1|0|1)`, `powerHit(0|1)` 세 개뿐입니다.
  [`PikaKeyboard`](src/resources/js/keyboard.js)는 이 클래스를 상속해 키보드 상태를 이 세 필드로 변환합니다.
- 기본 탑재 AI는 별도 클래스가 아니라, `player.isComputer === true`일 때
  [`physics.js:502-504`](src/resources/js/physics.js#L502-L504)에서 `letComputerDecideUserInput()`이
  같은 틱의 `userInput` 객체를 직접 덮어쓰는 방식으로 동작합니다.
- **즉, "참가자 에이전트"를 끼워 넣는 가장 자연스러운 지점은 `PikaUserInput`을 상속하는 새 클래스를 만들어
  `pikavolley.js`의 `keyboardArray`(생성부: [`pikavolley.js:42-51`](src/resources/js/pikavolley.js#L42-L51))에
  꽂는 것**입니다. `physics.runEngineForNextFrame`은 배열 원소가 `getInput()` 결과로 세 필드만 채워주면
  그게 키보드든 AI든 참가자 코드든 신경 쓰지 않습니다.

이 프로토콜의 구체적인 스펙(에이전트가 매 틱 받는 게임 상태 스냅샷 형식, 틱 길이가 40ms(1프레임)로
고정인지 등)은 아직 확정이 아닙니다 → [CONTRACTS.md](docs/agent-dev/CONTRACTS.md)가 SOR이고,
현재 DRAFT 상태입니다.

## 3. 개발 트랙 & 순서

4개 트랙, 아래 순서로 진행 (근거와 세부 계획은 [PHASES.md](docs/agent-dev/PHASES.md)):

1. **입력 구조 개편** — 참가자 코드가 매 틱 입력을 결정하는 새 구조. 나머지 모든 트랙의 전제.
2. **테스트 환경** — 참가자가 자기 코드 vs 자기 키보드, 자기 코드 vs 기본 AI로 붙어볼 수 있는 로컬 환경. 대회 준비 기간 내내 참가자가 쓸 것이므로 UX 우선순위 높음.
3. **제출 / 중계** — 코드 제출받아 중계 PC에서 실행/관전하는 방식.
4. **스킬 추가 & 에셋 교체** — 후순위. 새 스킬, 배경/현수막 등 이미지 교체.

## 4. 협업 규칙 (여러 명이 각자 다른 에이전트 도구를 씀)

- **진입점**: 어떤 도구를 쓰든 `CLAUDE.md`/`AGENTS.md` 중 무엇을 먼저 읽든 결국 이 파일로 오게 됩니다. 규칙은 이 파일 하나에만 적으세요. 도구별 파일에 별도 규칙을 추가하지 마세요.
- **세션 시작**: [KICKOFF.md](docs/agent-dev/KICKOFF.md)의 프롬프트를 복붙해서 시작하세요. 매번 컨텍스트를 처음부터 설명하지 않기 위한 장치입니다.
- **검증은 로컬에서, 리뷰는 정기 회의에서**: 이 프로젝트는 CI/CD를 두지 않기로 했습니다(자동화보다 대면 코드리뷰를 우선). 대신 커밋 전 [VERIFY.md](docs/agent-dev/VERIFY.md) 체크리스트를 로컬에서 직접 돌리고, [TRACKER.md](docs/agent-dev/TRACKER.md)에 기록을 남겨 회의 때 그걸 보고 리뷰합니다.
- **모르는 건 멋대로 정하지 않기**: 스펙이 불확실하면 그 자리에서 결정하지 말고 최소한의 stub(임시 기본값)으로 막아두고 [DECISIONS.md](docs/agent-dev/DECISIONS.md)에 등재하세요. 특히 `CONTRACTS.md`에 있는 값(틱 길이, 입출력 프로토콜 등)은 검증 과정에서 바뀔 수 있다고 이미 논의됨 — 혼자 확정 짓지 말 것.
- **트랙 담당(오너십)**: 트랙별 담당자/리뷰어는 아래 표에 채워 넣으세요 (TODO: 팀장 작성).

| 트랙 | 담당(구현) | 리뷰 | 주로 쓰는 도구 |
|---|---|---|---|
| ① 입력 구조 개편 | TODO | TODO | TODO |
| ② 테스트 환경 | TODO | TODO | TODO |
| ③ 제출/중계 | TODO | TODO | TODO |
| ④ 스킬/에셋 | TODO | TODO | TODO |

## 5. 코딩 컨벤션 / 명령어

- Lint: `eslint:recommended` + prettier(`singleQuote`) — 설정은 [`.eslintrc.json`](.eslintrc.json), [`.prettierrc.json`](.prettierrc.json).
- 빌드: `npm run build` (webpack), 개발 서버: `npm start` (`webpack serve --config webpack.dev.js`).
- 아직 자동화된 테스트 스위트는 없습니다. 추가하게 되면 이 섹션과 VERIFY.md를 함께 갱신하세요.
- 커밋 전 반드시 [VERIFY.md](docs/agent-dev/VERIFY.md) 체크리스트를 실행하세요 (`npm run verify` 스크립트 참고).

## 6. 문서 지도

| 파일 | 역할 |
|---|---|
| [docs/agent-dev/CONTRACTS.md](docs/agent-dev/CONTRACTS.md) | 에이전트 입출력 프로토콜, 틱 타이밍 상수 — SOR, DRAFT |
| [docs/agent-dev/PHASES.md](docs/agent-dev/PHASES.md) | 트랙별 세부 Phase 계획 (stub 확정 → codegen → 구현) |
| [docs/agent-dev/KICKOFF.md](docs/agent-dev/KICKOFF.md) | 세션 시작용 킥오프 프롬프트 템플릿 |
| [docs/agent-dev/VERIFY.md](docs/agent-dev/VERIFY.md) | 커밋 전 로컬 검증 체크리스트 |
| [docs/agent-dev/TRACKER.md](docs/agent-dev/TRACKER.md) | 커밋 해시 + 요약 기록 (회의 준비용) |
| [docs/agent-dev/DECISIONS.md](docs/agent-dev/DECISIONS.md) | 미확정 사항 백로그 (stub 처리한 것들의 등록부) |
