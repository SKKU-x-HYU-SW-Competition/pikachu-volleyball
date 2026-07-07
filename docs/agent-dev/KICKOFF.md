# KICKOFF.md — 세션 시작 프롬프트

새 에이전트 세션(Claude Code든, Codex CLI든, 다른 도구든)을 시작할 때 아래 블록을 그대로
복붙해서 첫 메시지로 사용하세요. 컨텍스트를 매번 새로 설명하는 비용을 없애기 위한 장치입니다.

---

```
이 저장소는 피카츄 배구(SW 교류전 대회용 포크)를 개조하는 프로젝트다.

시작하기 전에 반드시 아래 문서를 순서대로 읽어라:
1. AGENTS.md — 전체 진실 소스. 게임 루프/틱 구조, 협업 규칙 요약이 여기 있다.
2. docs/agent-dev/PHASES.md — 트랙별 진행 상태. 지금 어느 Phase가 어디까지 됐는지 확인해라.
3. docs/agent-dev/CONTRACTS.md — 에이전트 입출력 프로토콜/틱 타이밍 스펙(SOR). DRAFT 상태이니
   버전과 "변경 이력" 표를 확인해서 최신 버전을 기준으로 작업해라.
4. docs/agent-dev/DECISIONS.md — 아직 안 정해진 것들 목록. 여기 있는 항목을 임의로 확정 짓지 마라.

오늘 작업 범위:
- Phase: [여기에 Phase 번호/이름 기입]
- Task: [오늘 할 구체적인 작업 기입]
- 완료 기준: [이 세션이 끝났을 때 뭐가 되어 있으면 되는지 기입]

규칙:
- CONTRACTS.md에 없는 값/필드가 필요하면 마음대로 정하지 말고, 최소한의 stub으로 막아두고
  DECISIONS.md에 등재해라 (질문, 임시 처리, 이유).
- 커밋하기 전에 docs/agent-dev/VERIFY.md 체크리스트를 실행해라.
- 작업이 끝나면 docs/agent-dev/TRACKER.md에 커밋 해시 + 한 줄 요약을 추가해라. 다음 정기 회의
  코드리뷰 때 이걸 보고 리뷰하니, 남이 봐도 뭘 했는지 알 수 있게 써라.
- CI/CD는 없다. 자동으로 아무것도 검증되지 않으니 VERIFY.md를 건너뛰지 마라.
```

---

## 참고: 세션 종료 체크리스트

- [ ] `docs/agent-dev/VERIFY.md` 체크리스트 통과
- [ ] `docs/agent-dev/TRACKER.md`에 기록 추가
- [ ] 새로 발견한 미확정 사항이 있으면 `docs/agent-dev/DECISIONS.md`에 등재
- [ ] `docs/agent-dev/PHASES.md`의 해당 Phase `상태` 갱신
