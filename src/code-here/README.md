# src/code-here/

봇 코드 파일을 두는 폴더. 여기에 있는 파일들이 게임 UI의 "봇 선택" 드롭다운에 자동으로
나타난다 (webpack 빌드 시점에 스캔됨 — 파일 추가/삭제 후에는 `npm start` 재시작 필요 없이
dev 서버가 자동으로 리빌드해서 반영한다).

## 파일명 규약

```
<TeamName>_v<version>.<js|py>
```

- 팀명과 버전은 언더스코어 하나(`_v`)로 구분한다. 팀명 자체에 `_`가 들어와도 되지만
  마지막 `_v` 이전까지가 팀명, 그 뒤가 버전으로 파싱된다.
- 확장자가 언어를 결정한다: `.js` → JavaScript, `.py` → Python. 그래서 UI에 별도 언어
  선택은 없다.
- 버전은 문자열로만 다루므로 `1`, `1.2`, `20260814` 등 자유롭게. UI 정렬은 그냥 문자열
  정렬이다.

## 예제

- `Example_v1.js` — 팀 "Example", 버전 "1", JavaScript
- `Example_v1.py` — 같은 로직의 Python 포트

두 파일 모두 [`docs/agent-dev/CONTRACTS.md`](../../docs/agent-dev/CONTRACTS.md) §1의
`decide(snapshot)` 계약을 만족해야 한다.

관련 결정: [ADR-0020](../../docs/agent-dev/decisions/ADR-0020-bot-source-from-registry.md).
