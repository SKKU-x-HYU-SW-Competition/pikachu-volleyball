# ADR-0016 — TICK_FRAME_GROUP_SIZE 상향 (1 → 5)

| | |
|---|---|
| 상태 | RESOLVED |
| 결정일 | 2026-08-05 |
| 결정자 | Claude Code (팀장 결재) |
| 반영 | `src/resources/js/bot/botContract.js` `TICK_FRAME_GROUP_SIZE`, [CONTRACTS.md](../CONTRACTS.md) §2, [ADR-0001](ADR-0001-tick-frame-group-size.md)(SUPERSEDED) |

## 배경 (왜 막혔는지)

[ADR-0001](ADR-0001-tick-frame-group-size.md)에서 `TICK_FRAME_GROUP_SIZE = 1`(매 40ms)로 확정했었고,
그 결정 안에 "학습 기반 봇의 추론 비용이 실측에서 문제가 되면 재논의"라는 조항이 있음. 지금 두
가지 근거로 재논의:

1. **다국어 봇 지원**([ADR-0012](ADR-0012-multi-language-bot-support.md)): Pyodide 인터프리터가 매 틱
   `decide`를 호출하는 오버헤드(수 ms) + 참가자가 numpy 등을 쓰면 순간적으로 튐. 40ms 예산은 안전
   마진이 얇음.
2. **밸런스 문제 (팀장 관찰)**: 매 프레임 결정이면 봇이 참고할 수 있는 정보량이 너무 많고 반응이
   즉각적이라, 양쪽 다 잘 짠 봇끼리 경기가 승부가 잘 나지 않고 늘어지는 경향. 사람 대회 관전용으로
   "봇도 놓치는 순간이 있는" 편이 관전 재미와 전략 변별력에 낫다는 판단.

## 결정

**`TICK_FRAME_GROUP_SIZE = 1 → 5`** (200ms 예산). JS 봇에도 동일 적용. [ADR-0001](ADR-0001-tick-frame-group-size.md)은
`SUPERSEDED (see ADR-0016)`으로 상태 갱신.

이유:
- 200ms면 Pyodide 호출과 간단한 numpy 연산이 함께 들어와도 여유가 있음. 5배 여유가 생기면
  참가자가 대회 현장에서 봇 로직을 즉흥 수정할 때 "타이밍 튜닝" 대신 "판단 규칙 자체"에 시간을 쓸
  수 있음.
- 5프레임 결정이면 봇의 반응 사이에 사람이 감지 가능한 지연(200ms)이 생김 — 강한 봇도 상대의
  기습 각도에 대한 재조준이 한 박자 늦어져 경기가 갈림. `expectedLandingPointX`가 있어도 그 지연
  동안 값이 크게 바뀌면 봇이 못 따라가는 상황이 생김 → 전략 변별력 증가.
- 값 자체는 `botContract.js:34`의 상수 하나. 실측 결과 3이 낫거나 7이 나으면 후속 ADR로 재조정
  가능. 이번엔 팀장 관찰 + Pyodide 여유 두 근거로 5를 기본값으로.
- 파생 상수 `BOT_RESPONSE_TIMEOUT_MS`([`botContract.js:43`](../../../src/resources/js/bot/botContract.js#L43))는
  `MS_PER_FRAME * TICK_FRAME_GROUP_SIZE * 3`이라 자동으로 40ms×5×3 = **600ms**까지 늘어남. Pyodide
  첫 콜의 워밍업(첫 몇 틱은 상대적으로 느림)까지 흡수 가능.

## 트레이드오프

- **키보드 vs 봇 매치에서 봇의 반응 지연이 사람 눈에도 감지됨** — 순수 반사속도 비교가 아니라
  "판단의 질" 비교가 되는 셈. 대회 성격상 오히려 원하는 방향.
- **파워히트/다이빙 발동 타이밍이 5프레임 단위로 이산화** — 원본 게임의 프레임 정밀 조작 대비
  섬세도는 떨어짐. 다만 봇 프로토콜은 애초에 원본 키보드와 다른 특성(1틱 파이프라인 지연,
  [ADR-0009](ADR-0009-worker-async-latency.md))이라 이 정도 이산화는 감수.
- **Phase 2 회귀 테스트(JS 봇 vs 봇)를 다시 돌려서 봇이 여전히 정상 진행되는지 확인 필요** —
  Phase B(TICK 상향) 커밋 뒤 별도 검증.
