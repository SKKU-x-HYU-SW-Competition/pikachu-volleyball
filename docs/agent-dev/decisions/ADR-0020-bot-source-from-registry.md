# ADR-0020 — 봇 코드 입력 방식 (텍스트 붙여넣기 → 파일 레지스트리)

| | |
|---|---|
| 상태 | RESOLVED |
| 결정일 | 2026-08-14 |
| 결정자 | 팀장 (Claude Code 구현) |
| 반영 | 신규 폴더 [`src/code-here/`](../../../src/code-here/), 신규 [`src/resources/js/bot/botRegistry.js`](../../../src/resources/js/bot/botRegistry.js), [`webpack.common.js`](../../../webpack.common.js) `module.rules` 추가, [`testSetup.js`](../../../src/resources/js/bot/testSetup.js) 리팩터, `src/{en,ko,zh}/index.html` bot-setup 마크업 + 점수 아래 팀 라벨 오버레이, [`style.css`](../../../src/resources/style.css)의 `.bot-setup-select*` / `.team-label*` 추가, `src/resources/js/code/exampleBots.js` 삭제 |

## 배경

지금까지 Bot Setup 패널은 좌/우 각 진영마다 `<textarea>`에 봇 소스를 **직접 붙여넣는** 방식이었다
([ADR-0010](ADR-0010-bot-setup-double-listener-bug.md) 시절의 기본 UI). 언어는 별도 라디오(JS/PY)로
선택했고, 예제는 [`exampleBots.js`](https://example)의 문자열 상수를 "예제 봇 불러오기" 버튼으로
붙여넣었다.

대회 진행을 시뮬레이션하면서 이 방식의 문제가 드러났다:

1. **여러 참가팀의 코드를 번갈아 시험하기 어렵다.** 팀별로 소스를 저장해 두고 있어도 매번 붙여넣기를
   해야 하고, localStorage에는 마지막에 붙여넣은 소스 하나만 남는다.
2. **화면에 지금 뛰고 있는 봇이 누구 건지 표시가 없다.** 중계/관전 상황에서 점수 옆에 팀명이 없으면
   구분이 안 된다.
3. **언어를 파일과 분리해서 관리하는 게 실수 유발적.** JS 파일을 붙여넣고 언어 라디오가 Python으로
   남아 있으면 즉시 실행 에러가 나는데 원인을 찾기 어렵다.

## 결정

봇 코드는 파일로 관리하고, UI는 그 파일들을 드롭다운으로 노출하는 방식으로 바꾼다.

### 폴더 & 파일명

- **위치**: `src/code-here/` (팀장 결정, 2026-08-14). `src/resources/` 밖에 두는 이유는 이 폴더는
  프레임워크 자산이 아니라 **참가자 콘텐츠**라 성격이 다르기 때문이다.
- **파일명**: `<TeamName>_v<version>.<js|py>`. 팀장 결정으로 구분자는 언더스코어 하나(`_v`)를 쓴다.
  팀명 자체에 `_`가 있어도 되며, 파싱은 **마지막 `_v` 기준**으로 팀명/버전을 나눈다.
- **언어는 확장자로 결정**한다. UI에 별도 언어 선택 없음.
- 파일 예시:
  - `Example_v1.js` — 팀 "Example", 버전 "1", JavaScript
  - `Team_A_v20260814.py` — 팀 "Team_A", 버전 "20260814", Python

### 빌드 시점 인덱싱

브라우저는 파일시스템을 못 읽으므로 webpack이 빌드 시점에 폴더를 훑는다.

- [`webpack.common.js`](../../../webpack.common.js)에 `module.rules`를 추가해 `src/code-here/` 아래
  `.js`, `.py` 파일을 `type: 'asset/source'`로 로드한다. 이걸로 참가자는 ESM 보일러플레이트 없이
  최상위 `function decide(...)` 하나짜리 파일을 넣을 수 있다.
- [`botRegistry.js`](../../../src/resources/js/bot/botRegistry.js)가 `require.context`로 그 폴더를
  스캔해 `[{id, team, version, language, source, displayLabel}, ...]`를 반환한다.
- dev 서버(`npm start`)는 이 폴더 변경을 감시하므로, 파일 추가/제거 후 브라우저를 새로고침하면
  드롭다운에 반영된다.
- **런타임 파일 업로드 UI는 이번 스코프에서 제외**한다 (팀장 결정, 2026-08-14). 대회 현장 흐름은
  "운영진 PC의 `src/code-here/`에 파일을 드롭 → 새로고침"으로 충분하다는 판단.

### UI 변경

`src/{en,ko,zh}/index.html`의 `bot-setup-box`에서:
- 언어 라디오 그룹(`.bot-setup-language-group`), textarea(`.bot-setup-textarea`),
  "예제 봇 불러오기" 버튼을 모두 제거.
- 대신 진영마다 `<select id="bot-setup-{side}-bot">` 하나. 빈 첫 옵션이 placeholder 역할.

`testSetup.js`의 side config가 `{mode, source, language}`에서 `{mode, botId}`로 축소된다. `bot`
모드일 때 Apply 시점에 `getBotById(botId)`로 `source`와 `language`를 뽑아 `PikaBotInput`에 넘긴다.
`PikaBotInput` API 자체는 변경 없음 (여전히 `botSource`/`language`를 받음).

### 팀명/버전 화면 표시

`#game-canvas-container` 안에 `<div id="team-label-{left,right}">` 두 개를 두고, 점수판(PIXI가
원본 좌표 y=10에 32px 높이로 그림) 바로 아래(원본 y≈44) 위치에 CSS로 절대배치한다. 좌표는
`var(--canvas-width)` / `var(--canvas-height)` 기반이라 창 크기 변경에 자동으로 따라간다.

표시 텍스트:
- keyboard 모드 → 빈 문자열
- ai 모드 → "기본 AI"
- bot 모드 → `<team> v<version>`

**매치 진행 중에만** 표시한다 — `syncWithGameState`가 `round / afterEndOfRound /
beforeStartOfNextRound` 상태에서만 라벨을 채우고, 인트로 / 캐릭터 선택 / 승자 스플래시로 넘어가는
순간 지운다. `keyboardArray`에 봇 입력을 install/uninstall하는 것과 동일한 매치 경계에 묶어서,
저장된 config가 bot이더라도 실제로 로드되기 전에는 표시되지 않고, 라운드 사이 인트로 화면에서도
게임 아트에 텍스트가 겹치지 않는다.

## 대안

- **(A) 참가자가 손으로 관리하는 `bots/index.js`에 배열로 등록**: 파일 추가할 때마다 인덱스 편집이
  필요해서 놓치기 쉬움. 채택 안 함.
- **(B) 런타임 업로드 UI(파일 선택창 / drag&drop)**: 대회 흐름에 필수 아님. 향후 필요하면 별도 ADR로
  다룸.
- **(C) 언어 라디오 유지 + 파일명은 확장자만 다르게**: 파일에 언어 정보가 이미 있는데 UI에서 또
  고르는 건 실수 유발. 채택 안 함.

## 마이그레이션 노트

- 구 localStorage 키(`pv-bot-{side}-source`, `pv-bot-{side}-language`)는 신규 코드가 읽지 않으므로
  그대로 남아 있어도 무해하다. 별도 마이그레이션 로직 없음.
- 기존 예제(`exampleBots.js`의 `CHASE_BOT_SOURCE` / `CHASE_BOT_SOURCE_PY`)는
  `src/code-here/Example_v1.js` / `.py`로 이관했다. 원본 파일은 삭제.
- 아키텍처 문서(`docs/architecture/03-bot-integration.md`, `04-bot-writing-guide.md`,
  `05-skill-extension-guide.md`)에는 아직 `exampleBots.js` 언급이 남아 있으므로, 트래커에 남긴 뒤
  다음 문서 정리 커밋에서 함께 갱신한다.
