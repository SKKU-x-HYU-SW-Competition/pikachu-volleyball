# Modular power bot

DuckLL의 Super AI가 사용하는 아이디어를 현재 참가자 봇 계약 위에서 독립 구현한 JavaScript 봇입니다.
`physics.js`와 `botContract.js`는 수정하지 않으며, 봇이 받는 공개 스냅샷만 사용합니다.

외부 저장소는 별도 라이선스가 명시되지 않았으므로 코드를 그대로 복사하지 않았습니다. 이 저장소에
공개된 원작 물리식과 관찰 가능한 기술 동작을 바탕으로 새로 작성한 구현입니다.

## 바로 실행하기

Bot Setup에서 JavaScript를 선택한 다음 [`power-bot.js`](power-bot.js) 전체를 붙여넣습니다. 번호가
붙은 파일은 개발·검토용 모듈이며 브라우저 Worker가 `import`를 허용하지 않기 때문에 개별 파일만
붙여넣어 실행할 수는 없습니다.

```sh
node src/resources/code/power-bot/build-power-bot.cjs
node src/resources/code/power-bot/test-power-bot.cjs
```

첫 명령은 아래 모듈을 번호순으로 연결해 `power-bot.js`를 다시 만듭니다. 두 번째 명령은 Worker와
같은 방식으로 단일 소스를 평가하고 LEFT/RIGHT 연속 스냅샷에서 액션 범위와 물리 예측기를 검사합니다.

## 모듈

| 파일                           | 구현 기술                                                                 |
| ------------------------------ | ------------------------------------------------------------------------- |
| `00-core.js`                   | 코트 상수, 좌우 대칭 처리, 설정, 라운드 상태, 재현 가능한 난수            |
| `01-physics-predictor.js`      | 벽·천장·네트 충돌을 포함한 무접촉 공 궤적, 6종 파워히트 궤적              |
| `02-state-and-reachability.js` | 비공개 player y속도 추정, 점프 궤적, 도달·캐치·블로킹 가능성              |
| `03-defense.js`                | 상대의 6종 공격 예측, 5개 방어 모드, 전진 방어, 블로킹, 다이빙            |
| `04-offense.js`                | 최단/최원거리 공격, 안티 블로킹, 첫 타격 예약, 재점프·flat/drop·juke 콤보 |
| `05-serve-machine.js`          | LEFT 10종/RIGHT 8종 비대칭 기술 서브와 단순 서브                          |
| `06-controller.js`             | 서브→회복→블록→공격 계획→다이빙→일반 수비 우선순위와 `decide()`           |

## 공격 후보

파워히트의 `x` 부호는 공의 진행 방향을 정하지 않습니다. 엔진은 공이 있는 코트에 따라 상대편 방향을
정하고, `abs(x)`로 속도 10/20을 선택합니다. `y`는 타구 각도를 정합니다.

| 번호 | 이름          | 반환 입력의 의미 |
| ---: | ------------- | ---------------- |
|    0 | `UP_WEAK`     | `x=0, y=-1`      |
|    1 | `UP_STRONG`   | `abs(x)=1, y=-1` |
|    2 | `FLAT_WEAK`   | `x=0, y=0`       |
|    3 | `FLAT_STRONG` | `abs(x)=1, y=0`  |
|    4 | `DOWN_WEAK`   | `x=0, y=1`       |
|    5 | `DOWN_STRONG` | `abs(x)=1, y=1`  |

공격기는 여섯 궤적을 바닥까지 전개한 뒤 자기 코트에 떨어지는 후보를 제외합니다. 남은 후보에서
비블로킹 궤적을 우선하고, 착지 시간·상대와 착지점의 거리로 순위를 정합니다. 첫 타격 궤적이 자기
코트에서 다시 접촉 가능하면 두 번째 위치와 재점프를 예약합니다.

## 설정

`00-core.js`의 `PowerBot.config`에서 조절합니다. 수정 후에는 빌드 명령으로 단일 파일을 갱신해야
합니다.

- `defenseMode`: `CENTER`, `MIRROR_CENTER`, `MIRROR`, `PREDICT`, `ADVANCED_FORWARD`
- `reactionDelayFrames`: 예상 착지점 추종을 늦추는 엔진 프레임 수
- `enablePredictiveDefense`, `enableDiving`, `enableBlocking`
- `enableFancyCombos`, `enableAntiBlock`, `enableServeSkills`
- `enableRandomVariation`: 동률 후보와 원거리 공격 변주
- `actionLeadFrames`: Worker 응답이 적용되기 시작할 것으로 보는 보수적 엔진 프레임 수
- `debug`: 계획 로그 활성화용 플래그

## 현재 계약에서의 재현 한계

DuckLL 내장 AI는 매 엔진 프레임 입력을 바꾸지만 참가자 봇은 3프레임마다 호출되고 Worker 응답도
비동기입니다. 따라서 1프레임짜리 서브 입력과 정확히 한 프레임에만 눌러야 하는 콤보를 동일하게
재현할 수 없습니다.

이 구현은 다음 방식으로 적응합니다.

- 공 물리는 벽시계 시간이 아니라 원작과 같은 엔진 프레임 단위로 계산합니다.
- 공과 선수는 모두 현재 스냅샷을 같은 frame 0으로 사용하고, 예상 입력 적용 구간과 접촉 구간이
  겹칠 때만 타격합니다.
- 타격 범위를 실제 충돌 반경보다 넓게 잡고 `state=2`에서도 같은 샷 입력을 유지합니다.
- 1프레임 서브 phase는 최소 한 decision group 동안 유지되는 양자화된 기술로 실행합니다.

정확한 1프레임 재현이 대회 규칙상 필요하다면 `TICK_FRAME_GROUP_SIZE=1`은 계약 변경이므로 먼저
별도 ADR과 팀 결정을 거쳐야 합니다.
