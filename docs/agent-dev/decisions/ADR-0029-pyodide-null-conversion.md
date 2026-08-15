# ADR-0029 — Pyodide가 JS `null`을 `None`이 아닌 `JsNull`로 바꿔 Python 봇이 마비되는 문제

| | |
|---|---|
| 상태 | **OPEN (미착수)** — 원인 규명·계측 완료, 코드 수정 없음 |
| 발견일 | 2026-08-15 |
| 발견자 | imtmtl 요청으로 Claude Code가 병합 후 점검 중 계측 |
| 반영 | 아직 없음. 수정 대상은 `src/code-here/Example_v1.py`, 문서는 `04-bot-writing-guide.md`·[CONTRACTS.md](../CONTRACTS.md) §1.4 |
| 관련 | [ADR-0023](ADR-0023-snapshot-skill-state.md)(이 코드가 들어온 결정), [ADR-0013](ADR-0013-python-decide-signature.md), [ADR-0017](ADR-0017-python-execution-failure.md), [ADR-0002](ADR-0002-timeout-and-invalid-response.md)(중립 폴백) |

## 요약

**`Example_v1.py`는 한 번도 움직이지 않는다.** 매 틱 `decide()`가 예외를 던지고
[ADR-0002](ADR-0002-timeout-and-invalid-response.md)의 중립 입력 폴백이 그걸 삼킨다. 에러도,
경고도, 콘솔 출력도 없다.

원인은 봇 코드의 논리가 아니라 **Pyodide의 타입 변환**이다. 스냅샷의 JS `null`이 Python `None`이
되지 않고 `JsNull`이라는 별도 센티널 객체가 된다.

## 계측

봇 vs 봇으로 붙여 `PikaBotInput.latestAction`(Worker가 실제로 돌려준 액션)을 메인 스레드에서
프레임마다 읽었다. 같은 로직의 JS/Python 포팅 쌍이다.

| 봇 | 중립이 아닌 액션 | 액션 분포 |
|---|---|---|
| `Example_v1.js` | **707 / 743** | `1,0,0`×388, `-1,0,0`×200, `1,-1,0`×65, `1,-1,1`×22, … |
| `Example_v1.py` | **0 / 828** | `0,0,0`×828 |

스냅샷이 Python 쪽에서 실제로 어떤 타입인지 직접 찍어봤다(진단용 봇을 레지스트리에 임시 등록):

```
dbgType   = "JsNull"     # type(s['self']['claw']).__name__
dbgRepr   = "jsnull"
dbgIsNone = false        # s['self']['claw'] is None  →  False
dbgBool   = false        # bool(s['self']['claw'])    →  False
dbgSnapType = "dict"     # 스냅샷 자체는 정상적으로 dict로 변환됨
```

## 원인

`bot/botContract.js`의 `toClawView()`는 발톱이 없을 때 **JS `null`** 을 넣는다. Pyodide는 이걸
`None`이 아니라 `JsNull`로 바꾼다. `JsNull`은 **falsy이지만 `None`은 아니다.**

`Example_v1.py`의 두 곳이 정확히 `is None` / `is not None`으로 판정한다:

```python
# 19행 -- dodge_direction()
if not s['config']['claw'] or incoming is None or incoming['framesUntilStrike'] <= 0:
```

`incoming is None`이 **거짓**이므로 세 번째 항을 평가하고, `JsNull['framesUntilStrike']`에서
**TypeError**가 난다. `dodge_direction()`은 `decide()`가 매 틱 호출하므로 봇은 매 틱 죽는다.

```python
# 36행 -- choose_skill_x()
if s['self']['claw'] is not None:
    return None  # ours is still in flight
```

이쪽은 **항상 참**이라 조기 반환한다. 즉 예외를 고치더라도 **Python 봇은 스킬을 영영 못 쓴다.**
게이지를 강제로 100으로 채우고 재봐도 발동 0회였고, 같은 조건에서 JS는 34회 발동했다.

`skillX`가 `None`이면 Pyodide 변환에서 **키 자체가 사라진다**(액션 키가 `["x","y","hit"]`로 온다).
상수 `skillX: 200`을 돌려주는 최소 봇으로는 849/849가 정상 전달되므로 **변환 경로 자체는 멀쩡하다** —
문제는 값이 항상 `None`이라는 것.

## 언제부터 있었나

**이번 `develop` → `develop-skill` 병합(`f44283b`)이 만든 것이 아니다.**
[ADR-0023](ADR-0023-snapshot-skill-state.md) 구현 커밋 `00116ab`부터 있었다. 병합 전
`5dc0d5f`의 `src/resources/js/code/exampleBots.js`(`CHASE_BOT_SOURCE_PY`)에도 같은 세 줄이
그대로 있고, 병합은 그 코드를 `src/code-here/Example_v1.py`로 옮기기만 했다.

### 왜 그때 안 잡혔나 (재발 방지 관점에서 이쪽이 더 중요하다)

`00116ab`의 TRACKER 기록은 *"예제 봇은 JS·Python을 **동일한 9케이스**로 각각 실행해 포팅 동등성
확인"* 이라고 적고 있다. 그 검증은 **가짜 스냅샷을 Python 쪽에서 만들어** 돌린 것이라 발톱 없음이
진짜 `None`이었다. 실제 Pyodide 브리지를 한 번도 통과하지 않았고, 브리지가 바로 이 버그가 사는
곳이다.

- **교훈**: 언어 포팅의 동등성은 *같은 입력을 각 언어에서 만들어* 비교하면 증명되지 않는다.
  **같은 게임에서 나온 스냅샷이 각 러너를 통과한 결과**를 비교해야 한다.
- 이 버그는 `npm run verify`(lint·build), 계약 검사 봇(`skill_contract_check_bot.js`), 콘솔 에러
  감시를 **전부 통과한다.** 봇이 죽어도 ADR-0002가 중립 입력으로 조용히 대체하기 때문이다.
  현재 우리 검증 수단 중 "봇이 실제로 움직이는가"를 보는 것은 없다.

## 부수 발견 — Python 봇은 디버깅 수단이 없다

`bot/botWorkerPython.js`에 stdout 배선이 전혀 없다(`setStdout`도, `console.log` 중계도 없음).
참가자의 `print()`는 어디에도 나타나지 않는다. `Example_v1.py`가 들고 있는 로깅 블록
(`LOG_EVERY_N_TICKS`)도 죽은 코드다. JS 봇의 `console.log`는 Worker 콘솔로 정상 출력되므로
**언어에 따라 디버깅 난이도가 크게 다르다.**

## 선택지

수정 자체는 두 줄이다. `JsNull`은 falsy이고 실제 발톱 dict는 truthy이므로 **`is None` 대신 truthy
검사**로 바꾸면 두 경우 모두 맞는다.

```python
if not s['config']['claw'] or not incoming or incoming['framesUntilStrike'] <= 0:
if s['self']['claw']:
```

다만 예제 한 파일만 고치는 것으로 끝낼 사안이 아니다. 결정이 필요한 것:

1. **예제 수정만** — `Example_v1.py` 두 줄. 가장 작지만, 참가자가 스스로 `is None`을 쓰면 똑같이
   당한다. 그리고 **그때도 에러가 안 나서 원인을 못 찾는다.**
2. **문서화 병행** — `04-bot-writing-guide.md` Python 절과 [CONTRACTS.md](../CONTRACTS.md) §1.4에
   "스냅샷의 `null`은 Python에서 `None`이 아니다. `is None` 대신 truthy 검사를 써라"를 명시.
   1번과 같이 가는 게 자연스럽다.
3. **러너에서 정규화** — `botWorkerPython.js`가 스냅샷을 넘기기 전에 `JsNull`을 `None`으로 바꿔
   준다. 참가자 입장에서 가장 안전하고 "파이썬답게" 짜면 그냥 동작한다. 대신 변환 비용이 매 틱
   스냅샷 전체에 붙고(틱 예산은 [ADR-0016](ADR-0016-tick-frame-group-size-raised.md) 참고),
   러너가 프로토콜에 손대는 계층이 하나 늘어난다.
4. **stdout 배선 추가** — 위와 별개로, Python 봇의 `print()`가 콘솔에 나오게 한다. 이게 없으면
   참가자는 이런 종류의 문제를 스스로 진단할 방법이 없다.

**3번은 프로토콜 계층의 변경이라 회의 안건이다.** 1·2번만 먼저 하고 3번을 회의에서 정하는 것도
가능하다.

## 검증 항목 (수정 시)

- `Example_v1.py`의 중립이 아닌 액션 비율이 JS와 비슷한 수준으로 올라올 것 (현재 0/828)
- 게이지를 채운 조건에서 Python 봇의 claw 발동이 0이 아닐 것 (현재 0회, JS는 34회)
- 위 두 가지를 **가짜 스냅샷이 아니라 실제 대전**으로 잴 것 — 이 버그를 놓친 원인이 그것이다
