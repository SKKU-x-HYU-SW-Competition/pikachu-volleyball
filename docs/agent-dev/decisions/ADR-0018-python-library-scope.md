# ADR-0018 — Python 봇 사용 가능 라이브러리 범위 (표준 + numpy)

| | |
|---|---|
| 상태 | RESOLVED |
| 결정일 | 2026-08-05 |
| 결정자 | Claude Code (팀장 결재) |
| 반영 | `src/resources/js/bot/botWorkerPython.js`(예정, 자동 `loadPackage('numpy')`), 참가자 배포판 규정 문서(추후) |

## 배경 (왜 막혔는지)

Pyodide는 파이썬 표준 라이브러리 외에도 numpy/scipy/scikit-learn/pandas 등 주요 과학 계산 라이브러리를
사전 빌드된 wheel로 제공. 어디까지 자동으로 활성화해서 참가자에게 열어줄지 결정 필요. 트레이드오프:

- 많이 열수록 참가자 표현력↑, 배포 파일 크기 + 초기 로드 시간↑
- 대회 성격(현장 코드 수정 대회)상 학습 기반 봇은 애초에 우선순위가 낮고, 규칙 기반 + 간단한 수치
  계산이 주력.

## 결정

**Python 표준 라이브러리 + numpy까지 확정.**

동작:
- `botWorkerPython.js`가 Pyodide 부팅 직후 자동으로 `pyodide.loadPackage('numpy')` 실행. 참가자는
  별도 설치 절차 없이 `import numpy as np`가 즉시 됨.
- scipy/scikit-learn/pandas 등은 기본 미포함. 참가자가 소스에서 `import scipy` 하면
  `ModuleNotFoundError` → [ADR-0017](ADR-0017-python-execution-failure.md)의 초기화 실패 → UI에 에러
  표시.

이유:
- **표준 라이브러리는 무비용**: Pyodide에 이미 포함되어 있어 별도 로드 없음. math/random/collections/
  itertools/statistics 등 규칙 기반 로직에 필요한 것들은 여기 다 있음.
- **numpy는 사실상 표준**: 벡터/행렬 계산, 삼각함수, 배열 인덱싱 등 봇에서 흔히 쓰는 수치 연산의
  기본 도구. wheel 크기(압축 ~5MB)는 감수. 참가자 요구 빈도가 확실히 높음.
- **scikit-learn 등은 대회 방향과 불일치**: 대회 성격이 "학습 모델 시연"이 아니라 "규칙 기반/간단한
  판단 로직을 현장에서 즉흥 수정"이라, 무거운 학습 라이브러리를 기본값으로 여는 건 초점을 흐림.
  필요한 참가자가 실제로 나오면 그때 추가 ADR로 확장.

## 참가자 규정 문서 반영

- 대회 규정 문서(별도 산출물, [AGENTS.md](../../../AGENTS.md) §1 참고)에 "Python 봇에서 사용 가능한
  라이브러리: 표준 라이브러리 + numpy" 명시 필요. 참가자가 사전에 알아야 학습 기반 봇을 준비하다
  낭패 보지 않음.
- 대회 준비 기간 중 참가자가 다른 라이브러리를 요청하면 (i) Pyodide 지원 여부 확인, (ii) 지원되면
  새 ADR로 승인 후 `loadPackage` 목록에 추가하는 절차로 처리.

## 트레이드오프

- `dist/` 크기가 numpy wheel 만큼 추가로 증가 — [ADR-0014](ADR-0014-pyodide-distribution.md)의 정적
  복사 방침과 함께 감수.
- 첫 로드 시 numpy까지 loadPackage 하느라 시간이 좀 더 걸림. [ADR-0015](ADR-0015-pyodide-load-timing.md)의
  지연 로드로 JS 유저에게는 여전히 영향 없음.
