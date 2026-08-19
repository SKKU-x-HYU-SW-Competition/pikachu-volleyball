# ADR-0019 — 에셋 해상도 스케일링 배율 (RATIO)

| | |
|---|---|
| 상태 | RESOLVED |
| 결정일 | 2026-08-10 |
| 결정자 | Claude Code (팀장 결재) |
| 반영 | [`assets_path.js`](../../../src/resources/js/assets_path.js) `RATIO = 4` + 3-way `SPRITE_SHEET*`, [`main.js`](../../../src/resources/js/main.js) 렌더러 크기, [`view.js`](../../../src/resources/js/view.js) 좌표 스케일 + 1× 타일에 `.scale = RATIO` 워크어라운드, `src/resources/assets/images/sprite_sheet{,_pengsoo_left,_pengsoo_right}.{json,png}` |

## 배경 (왜 막혔는지)

원본 게임은 **432×304 논리 픽셀** 캔버스에 렌더링하고 CSS로 확대해서 보여준다
([`main.js`](../../../src/resources/js/main.js)의 `autoDetectRenderer`). `settings.RESOLUTION = 2`이므로
실제 백버퍼는 **864×608**이 상한이고, 그 이상의 디테일은 그려질 자리가 없다.

이 때문에 스프라이트시트에 고해상도 이미지를 넣어도 화면에서 뭉개진다. 실제로 커밋 `942f51e`에서
성한전 로고를 넣었으나 `sprite_sheet.json`은 그대로였고(= 기존 프레임 칸 안에 그려 넣음) 시트 크기도
476×885 그대로여서, 로고가 원본 아트 해상도와 무관하게 저해상도로 표시된다.

Phase 4(스킬/에셋 교체)에서 성한전 마스코트로 캐릭터·배경을 교체할 예정이므로, **화질 상한 자체를
올리는 방식**을 먼저 확정해야 한다.

## 선행 조사

원본의 다른 포크인 **DuckLL Super AI Edition**과 달리, **펭수 배구**
(`pengsoovolleyball.github.io`)가 정확히 이 문제를 해결해 두었다. 해당 저장소는 webpack 번들만
공개하지만 **소스맵(`main.bundle.js.map`)에 원본 `main.js`/`view.js`가 남아 있어** 방식을 확인할 수 있었다.

핵심은 `assets_path.js`의 상수 하나다:

```js
RATIO: 4, // physics coord vs viewr cord ratio
```

- 렌더러: `width: 432 * RATIO`, `height: 304 * RATIO`
- `view.js`: 그리는 좌표마다 `RATIO`를 곱함 (`this.player1.x = RATIO * player1.x`)
- `settings.RESOLUTION = window.devicePixelRatio` (고정 2 → 레티나 대응)
- 에셋은 정확히 4배로 다시 그림

에셋 크기 실측 비교:

| | 우리 (원본) | 펭수 | 배율 |
|---|---|---|---|
| 시트 전체 | 476 × 885 | 1756 × 1458 (+ 캐릭터 별도 시트 1808 × 1452) | — |
| 공 | 40 × 40 | 160 × 160 | 4× |
| 플레이어 | 64 × 64 | 256 × 256 | 4× |
| 산(배경 띠) | 폭 432 | 폭 1728 | 4× |

**핵심: 물리 좌표계는 건드리지 않는다.** `physics.js`는 무수정이고, 배율은 View 계층에서만 적용된다.
따라서 [CONTRACTS.md](../CONTRACTS.md) §1.2의 좌표 상수(`GROUND_WIDTH = 432`, 네트 `216`,
접지 `244`/`252` 등)와 봇 스냅샷 좌표가 **그대로 유효**하며, **이미 작성된 참가자 봇 코드는 영향을 받지 않는다.**

## 결정

### ① RATIO 값 — **4**

| 값 | 유효 해상도 | 장점 | 단점 |
|---|---|---|---|
| 2 | 864 × 608 | 시트가 한 장에 들어갈 여지 있음. 텍스처 메모리 부담 적음 | 배선 작업량은 4와 동일한데 화질 개선은 절반 |
| **4** | **1728 × 1216** | 펭수에서 **실증된 값**. 마스코트 아트가 충분히 선명 | 시트 분할 필요 (아래 ③) |
| 8 | 3456 × 2432 | — | 텍스처 총 면적 64배. 로딩·메모리 부담 대비 실익 낮음 |

**채택: 4.** 배선(`view.js` 좌표 전체)이 이미 끝나 있어 상수 하나로 값을 바꿨고, 펭수 배구 실증값
그대로 채용. 나중에 2나 8로 재조정하는 비용도 상수 하나.

### ② `settings.RESOLUTION` — **`2` 유지 (변경 없음)**

현재 `2` 고정. 펭수는 `window.devicePixelRatio`를 쓴다. 레티나에서 더 선명하지만 비레티나 환경에서
1이 되어 오히려 지금보다 나빠질 수 있다. **대회 시연 PC 사양이 확정되면 그에 맞춰 결정**하는 것이 안전하다.
이 항목은 별도 후속 ADR에서 다룬다 (본 ADR의 결정 범위 밖).

### ③ 스프라이트시트 분할 — **공용 + 좌/우 캐릭터 3분할, TexturePacker 유지**

현재 77개 프레임의 총 면적은 **332,440 px²**. 4배 시 **5,319,040 px²**로, 정사각형으로 채워도
한 변 **2,300px 이상**이 필요하다. 펭수 배구도 공용 시트와 캐릭터 시트를 분리해서 이 문제를 피했다.

**채택 분할 기준**: 펭수 배구 관례를 따라
- `sprite_sheet.json/png` — 공용 (ball, number, message, object, menu_background)
- `sprite_sheet_pengsoo_left.json/png` — 좌측 플레이어(pengsoo_left/*) + sitting_pengsoo + copyright_left
- `sprite_sheet_pengsoo_right.json/png` — 우측 플레이어(pengsoo_right/*) + copyright_right

3개 JSON은 각자 자기 PNG를 참조하며, `main.js`에서 순차적으로 `loader.add()`, `view.js`는
용도별로 `ASSETS_PATH.SPRITE_SHEET` / `SPRITE_SHEET_PLAYER_LEFT` / `SPRITE_SHEET_PLAYER_RIGHT`를
개별 참조한다. 프레임 키가 세 시트 사이에서 유일하다는 것은 asset dump로 확인 완료.

**패킹 도구**: 기존 **TexturePacker**를 그대로 사용 (원본 저장소의 관례를 유지). PNG만 교체하고
JSON을 갱신하지 않으면 프레임 좌표가 어긋나므로(과거 커밋 `942f51e` 사례), 아트 교체 시 반드시
JSON을 함께 갱신한다.

### ④ 자산 스케일 정책 — **하이브리드**

RATIO=4로 통일하는 게 이상적이지만, 실제 펭수 시트를 열어보니 캐릭터/공/숫자/메시지는 4×로
다시 그렸지만 **작은 배경 타일(sky_blue, ground_*, net_pillar*, shadow)은 1× 원본을 그대로
재활용**하고 있었다. 다시 그리는 노력 대비 시각적 이득이 없다는 판단으로 보임.

`view.js`는 이 이원 상태를 그대로 수용한다:
- 4× 자산 (`new Sprite(texture)`) → 별도 스케일 없이 사용
- 1× 타일 → 각 Sprite에 `.scale.x = .scale.y = RATIO`를 생성 시점에 적용

같은 이유로 shadow, menu_background도 `.scale = RATIO`. FadeInOut은 이 프로젝트가 이미
`@pixi/graphics`를 제거한 상태(commit b05d204)라 펭수 원본의 Graphics 대신
`Sprite(Texture.WHITE) + tint=0x000000`으로 대체.

## 후속 ADR 후보 (이 결정에 딸림, 별도 파일로)

- **`settings.RESOLUTION` 선택** (본 ADR §②에서 유보) — `2` 고정 vs `window.devicePixelRatio`.
  시연 PC 사양 확정 뒤 판단.
- **`forceCanvas` 유지 여부** — 현재 `true`. RATIO=4 + devicePixelRatio 2면 백버퍼가
  3456×2432가 되어 Canvas2D로는 25fps 유지가 어려울 수 있다. 펭수는 `forceCanvas`를 쓰지 않는다.
  다만 [`main.js`](../../../src/resources/js/main.js) 주석에 **"어떤 사용자 브라우저에서 WebGL 렌더러일 때
  그래픽이 깨진다는 제보가 있어 Canvas로 고정했다"** 는 기록이 있으므로, 실측 없이 뒤집으면 안 된다.
  → 시연 PC에서 두 렌더러를 실제로 비교한 뒤 별도 ADR.
- **`SCALE_MODE`** — 현재 `NEAREST`(픽셀아트용). 마스코트 아트가 픽셀아트가 아니라면 `LINEAR`가
  더 나을 수 있다. 아트 스타일이 확정된 뒤 판단.
- **작은 타일 자산(sky/ground/net/shadow) 4× 재출력 여부** — 지금은 `.scale = RATIO` 워크어라운드로
  대응하지만, `NEAREST` 확대라 확대 계단이 남는다. 마스코트 아트 톤이 확정되면 이 타일들도
  네이티브 4×로 다시 그려서 워크어라운드를 제거할 수 있다.

## 트레이드오프

- **텍스처 메모리 증가** — RATIO=4로 시트 총 면적이 이론상 16배. 실측 후 시트 크기는 원본
  476×885 → 공용 1756×1458 + 좌 1808×1452 + 우 1808×1116 (약 12배). 대회 현장 PC 사양과 로딩
  시간을 계속 관찰. 이미 Pyodide가 12.7MB를 차지하고 있어 초기 로딩 예산이 넉넉하지 않다.
- **에셋 제작 비용** — 캐릭터/공/숫자/메시지 4× 재작업 완료. 작은 타일은 1× 유지(§④).
- **되돌리기는 저렴하다** — 배선이 상수 한 줄이라 RATIO 값 자체 롤백은 쉽지만, 에셋 재제작은
  비싸므로 값 롤백 시엔 4× 에셋을 그대로 두고 상수만 낮추는 식(품질 낭비)이 된다.
