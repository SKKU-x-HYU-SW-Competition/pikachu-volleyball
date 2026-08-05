# 00. 프로젝트 개요 & 엔트리포인트 / 화면 구성

> 이 문서 시리즈의 목적: 엔진 수정, 스킬 추가, 밸런스/디자인 변경 등의 작업에 앞서
> 이 프로젝트(원작 Pikachu Volleyball을 리버스엔지니어링해 JS로 재구현한 게임)의
> 구조를 팀원들이 빠르게 파악할 수 있도록 한다.
>
> 문서 구성:
> - **00-overview.md** (이 문서): 전체 구조, 엔트리포인트, 화면 구성
> - [01-game-loop-and-physics.md](./01-game-loop-and-physics.md): 게임 루프(틱/프레임), 상태머신, 물리엔진
> - [02-input-keyboard.md](./02-input-keyboard.md): 키 입력 처리

## 1. 전체 구조 (MVC)

이 프로젝트는 코드 주석([main.js](../../src/resources/js/main.js) 상단)에 명시된 대로 MVC 패턴을 따른다.

| 역할 | 파일 | 설명 |
|---|---|---|
| **Model** | [physics.js](../../src/resources/js/physics.js) | 공/플레이어(피카츄)의 물리 연산. 원작 머신코드를 리버스엔지니어링한 핵심 로직 |
| **Model** | [cloud_and_wave.js](../../src/resources/js/cloud_and_wave.js) | 배경의 구름/파도 움직임 (역시 리버스엔지니어링 결과) |
| **View** | [view.js](../../src/resources/js/view.js) | PixiJS 기반 렌더링. 인트로/메뉴/게임화면/페이드 4개 뷰 |
| **Controller** | [pikavolley.js](../../src/resources/js/pikavolley.js) | 게임 상태머신을 관리하고 Model/View를 사용자 입력에 따라 제어 |

그 외 지원 모듈:

| 파일 | 역할 |
|---|---|
| [main.js](../../src/resources/js/main.js) | 진짜 엔트리포인트. PixiJS 초기화, 에셋 로딩, 게임 루프 시작 |
| [keyboard.js](../../src/resources/js/keyboard.js) | 키보드 입력을 읽어 Controller에 전달 (자세한 내용은 [02번 문서](./02-input-keyboard.md)) |
| [audio.js](../../src/resources/js/audio.js) | pixi-sound 기반 효과음/BGM 재생 (`PikaAudio`, `PikaStereoSound`) |
| [rand.js](../../src/resources/js/rand.js) | Model(물리엔진, 구름/파도)에서 쓰는 난수 생성기. 원작과 동일한 난수 알고리즘 재현 |
| [assets_path.js](../../src/resources/js/assets_path.js) | 이미지 스프라이트시트/사운드 파일 경로 상수 |
| [ui.js](../../src/resources/js/ui.js) | 메뉴바, 옵션 드롭다운 등 게임 캔버스 바깥 HTML UI 제어 |

## 2. 폴더 구조 요약

```
src/
├── index.html          # 언어 감지 후 ./en/ 로 리다이렉트
├── en/ ko/ zh/          # 언어별 index.html, manifest.json 등 (다국어 페이지 셸)
└── resources/
    ├── assets/          # 이미지(images), 사운드(sounds) 원본 에셋
    └── js/              # 실제 게임 로직 (위 표 참고)
webpack.common.js / webpack.dev.js / webpack.prod.js   # 빌드 설정 (webpack 5)
dist/                    # 빌드 산출물 (배포용)
```

빌드는 `npm start`(webpack-dev-server) / `npm run build`(프로덕션 빌드)로 실행한다. 자세한 빌드 파이프라인은 필요 시 별도 문서로 다룬다 (이번 문서 범위 밖).

## 3. 엔트리포인트

실행 흐름: `src/en/index.html` → 번들된 [main.js](../../src/resources/js/main.js) 스크립트 로드.

[main.js](../../src/resources/js/main.js) 안에서 일어나는 부팅 순서:

1. **PixiJS 전역 설정** ([main.js:60-76](../../src/resources/js/main.js#L60-L76)) — 렌더러 생성 (432×304 캔버스, Canvas 강제 사용, `forceCanvas: true`).
2. **에셋 로딩 시작** ([main.js:86-89](../../src/resources/js/main.js#L86-L89)) — 스프라이트시트와 사운드를 `Loader`에 등록.
3. **초기 UI 세팅** ([main.js:96-139](../../src/resources/js/main.js#L96-L139), `setUpInitialUI()`) — "About/Play" 버튼 클릭 시 실제 에셋 로딩 시작.
4. **게임 객체 생성** ([main.js:144-148](../../src/resources/js/main.js#L144-L148), `setup()`) — 에셋 로딩 완료 후 `new PikachuVolleyball(stage, loader.resources)` 생성 + [ui.js](../../src/resources/js/ui.js)의 `setUpUI()` 호출.
5. **게임 루프 시작** ([main.js:154-161](../../src/resources/js/main.js#L154-L161), `start()`) — PixiJS `Ticker`에 콜백 등록. 자세한 내용은 [01번 문서](./01-game-loop-and-physics.md) 참고.

`PikachuVolleyball` 클래스(Controller, [pikavolley.js](../../src/resources/js/pikavolley.js))가 생성되면서 Model(`PikaPhysics`)과 View(`IntroView`/`MenuView`/`GameView`/`FadeInOut`), 키보드(`PikaKeyboard` 2개), 오디오(`PikaAudio`)가 모두 이 시점에 함께 초기화된다 ([pikavolley.js:24-51](../../src/resources/js/pikavolley.js#L24-L51)).

## 4. 게임 화면 구성 (View)

렌더링은 하나의 PixiJS `stage`(Container) 위에 **4개의 레이어(Container)를 쌓는 방식**으로 구성된다 ([pikavolley.js:25-38](../../src/resources/js/pikavolley.js#L25-L38)):

| 순서 | View 클래스 | 정의 위치 | 내용 |
|---|---|---|---|
| 1 | `IntroView` | [view.js:26](../../src/resources/js/view.js#L26) | 서류가방 든 남자가 등장하는 인트로 화면 |
| 2 | `MenuView` | [view.js:73](../../src/resources/js/view.js#L73) | "With Computer / With Friend" 선택 메뉴 |
| 3 | `GameView` | [view.js:329](../../src/resources/js/view.js#L329) | 실제 경기 화면 (플레이어, 공, 배경, 점수판, 구름/파도 등) |
| 4 | `FadeInOut` | [view.js:651](../../src/resources/js/view.js#L651) | 화면 전환용 검은 페이드 오버레이 (최상단) |

각 시점에 어떤 레이어가 `visible = true`인지는 Controller([pikavolley.js](../../src/resources/js/pikavolley.js))의 상태머신이 전환한다 — 자세한 전환 로직은 [01-game-loop-and-physics.md](./01-game-loop-and-physics.md)의 "상태머신" 절 참고.

`GameView`는 배경, 네트, 그림자, 점수판, 두 플레이어 스프라이트, 공 스프라이트, 구름/파도를 모두 포함하는 가장 복잡한 뷰이며, 매 프레임 `drawPlayersAndBall(physics)` / `drawCloudsAndWave()` 호출로 Model의 최신 좌표를 화면에 반영한다 ([pikavolley.js:351-352](../../src/resources/js/pikavolley.js#L351-L352)).

## 5. 다음으로 볼 문서

- 게임 루프가 정확히 어떻게 도는지, 상태(state)가 어떻게 전이되는지, 물리엔진은 어디서 호출되는지 → [01-game-loop-and-physics.md](./01-game-loop-and-physics.md)
- 키 입력이 물리엔진까지 어떻게 전달되는지 → [02-input-keyboard.md](./02-input-keyboard.md)
