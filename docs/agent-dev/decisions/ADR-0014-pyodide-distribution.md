# ADR-0014 — Pyodide 배포 방식 (정적 복사)

| | |
|---|---|
| 상태 | RESOLVED |
| 결정일 | 2026-08-05 |
| 결정자 | Claude Code (팀장 결재) |
| 반영 | `webpack.common.js`(예정, `copy-webpack-plugin` 사용), `dist/pyodide/`(예정), `src/resources/js/bot/botWorkerPython.js`(예정) |

## 배경 (왜 막혔는지)

Pyodide 런타임(`pyodide.mjs`, wasm 바이너리, 파이썬 표준 라이브러리 zip, 필요한 wheel 등)은 압축
후에도 코어만 ~10MB, numpy까지 포함 시 ~15MB 규모. 배포 위치 선택지:

- **A. CDN**: `https://cdn.jsdelivr.net/pyodide/vX.Y.Z/full/`에서 런타임 로드. 저장소/dist 부담 0.
- **B. webpack 번들**: `pyodide` npm 패키지를 웹팩 그래프에 포함.
- **C. 정적 복사**: `copy-webpack-plugin`으로 `dist/pyodide/`에 파일 복사. 웹팩은 이 파일들을
  트랜스파일하지 않고 그대로 서빙.

## 결정

**C(정적 복사)로 확정.**

이유:
- 대회 현장 네트워크가 오프라인일 가능성을 배제할 수 없음. CDN 의존은 회복력이 낮고, 폐쇄망
  운영진 PC에서 리허설·실전 도중 CDN이 막히면 파이썬 봇 참가자가 통째로 못 씀. "정적 파일 하나
  배포하면 끝"이라는 현재 아키텍처의 이점([ADR-0012](ADR-0012-multi-language-bot-support.md))을 유지하려면
  런타임도 정적 파일이어야 함.
- 번들 방식(B)은 Pyodide의 특수한 파일 구조(zip 인덱스, 런타임 dynamic import, `indexURL` 기준
  상대 경로 로드 등)와 충돌 위험이 있고, Pyodide 공식 문서도 번들러 대신 **정적 서빙**을 권장.
  Worker 안에서 `loadPyodide({ indexURL })`을 호출하는 표준 사용법과도 그대로 맞물림.
- 저장소는 `pyodide/` 원본 파일을 커밋하지 않고 `npm i pyodide`로 `node_modules/pyodide/`에서 가져와
  `copy-webpack-plugin`이 빌드 시 `dist/pyodide/`로 복사하는 형태 — 저장소 크기 증가는 `package.json`
  의존성 한 줄뿐.
- 트레이드오프: `dist/` 크기가 ~15MB 커짐. 대회 배포판 zip이 좀 무거워지지만, 오프라인 안정성이
  훨씬 더 중요.

## 구현 메모

- Worker 내 로드는 `new URL('../pyodide/', import.meta.url).href`를 `indexURL`로 넘겨 dev
  (webpack-dev-server)와 prod에서 동일하게 동작하도록 함 (절대 경로 하드코딩 피함).
- Pyodide 버전은 설치 시점 최신(현재 `314.0.3`)로 `package.json`에 캐럿(`^`) 없이 정확한 버전
  고정 — 자동 minor 업데이트로 wasm 파일이 바뀌면 대회 당일 예기치 못한 회귀가 날 수 있어서.
  Pyodide는 최근 CalVer 계열 버전 스킴을 도입해 314 같은 큰 major 숫자가 나오지만 API(`loadPyodide`,
  `pyodide.runPython` 등)는 안정적으로 유지됨.
