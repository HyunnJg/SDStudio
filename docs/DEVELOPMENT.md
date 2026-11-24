# 개발 시작과 검증 기록

## 저장소 받기

```sh
git clone https://github.com/HyunnJg/SDStudio.git
cd SDStudio
git remote add upstream https://github.com/sunho/SDStudio.git
git switch -c work/p0-build-baseline
git submodule update --init --recursive
```

기존 체크아웃은 remote를 먼저 확인한다. 원본에는 두 서브모듈이 있다. 초기 작업공간 조사에서는 서브모듈을 로컬에 초기화하지 않고, 고정 리비전의 자료를 GitHub에서 읽었다.

## 첫 실행 전 프로필 격리 — 구현·Linux 기동 검증 완료

검토 결과, 기본 경로와 앱 이름이 원본과 같고 config의 `saveLocation`이 저장 경로를 다시 지정할 수 있음을 확인했다. **아래 명령 중 `npm start`는 P0-01a의 빈 개발 프로필 격리와 P0-02의 외부 요청 통제를 구현한 뒤에 실행한다.** P0-01a/P0-02는 구현했고 Linux에서 조건부 전체 기동도 검증했다. [실제 검증 기록](validation/2026-11-20-p0-profile.md)을 참고한다. 기존 원본 config·토큰·세션을 개발 프로필에 복사하지 않는다.

첫 검증 범위는 Electron 데스크톱이다. Android/iOS 패키징과 Python/BiRefNet 자체 빌드는 제외한다. 다만 루트가 참조하는 background-mode 서브모듈 등 실제 설치 의존성은 필요할 수 있다.

실행 순서는 설치·빌드(P0-01b, 앱 미실행) → P0-01a/P0-02 적용·검증 → 전체 기동(P0-01c)으로 나눈다. P0-01a의 프로필 경로 드라이런은 전체 앱 기동과 구분한다.

원본 설치본이 있는 PC에서는 앱을 닫은 뒤 **그 PC에서 확인한 원본 프로필 전체를 별도 위치에 백업**한다. 대소문자만 다른 폴더를 별도 프로필이라고 가정하지 않는다. 현재 작업 환경의 가짜 프로필 검증은 사용자 PC의 백업을 수행한 것이 아니다.

## 빌드 명령과 최초 조사 기록

원본 CI는 Node `22.4.1`을 사용한다. 먼저 해당 조합을 재현 기준으로 조사하고, 이후 현재 지원 버전으로 옮길 필요성을 판단한다. 오래된 CI 설정을 현재 지원 정책으로 간주하지 않는다. 네이티브 모듈 때문에 Python, C++ 컴파일러와 플랫폼별 빌드 도구가 필요할 수 있다.

아래는 원본 명령이다. 초기 구성 당시에는 미실행이었고, 현재 Linux의 설치·빌드 성공 및 남은 검증 범위는 위 검증 기록에 구분했다. 전체 기동의 환경별 한계는 [별도 기록](validation/2026-11-20-p0-offline.md)을 참고한다.

```sh
npm install
npm run build
npm run lint
npm start
```

- `npm install`의 preinstall은 `src/native`를 설치하고 node-gyp 빌드를 실행한다. postinstall은 Electron 의존성과 DLL 빌드를 처리한다. 단순 프런트엔드 설치와 다르다.
- `release/app/package.json`에도 별도 런타임 의존성과 postinstall이 있다. 실패 시 루트와 배포 폴더 중 어느 단계인지 기록한다.
- 원본은 lock 파일을 ignore했지만, 첫 구현에서 루트·`release/app`·`src/native`의 lock을 추적하도록 바꿨다. 이제 체크아웃에서 `npm ci`로 재현한다. Node 기준은 `22.4.1`이다.
- `npm start`는 개발 앱을 실행한다. 원본 프로필 격리와 P0-02 구현 후에 수행한다. 서비스 모듈을 import하는 테스트도 초기화 경로를 우회해야 한다. 기존 App 테스트 수정은 가짜 백엔드 확보 뒤에 진행한다.
- `npm run package`는 패키징 단계다. 첫 UI 검토에는 필요하지 않다.

## 2026-11-20 초기 조사 결과

| 항목 | 결과 |
| --- | --- |
| Git 원본 체크아웃 | 성공, 기준 `f2088add103ad683a31e0590448e6e5bb4d71556` |
| 조사 환경 | Linux, Node `24.22.3`, npm `11.19.1`, Python `3.12.14` |
| 의존성 설치 | 미실행 |
| 빌드 / lint / 앱 실행 | 미실행 |
| 실제 API 생성 | 미실행 |
| 문서 경로·링크 / diff 검사 | 통과. 문서 내부 링크와 소스 경로, 공백 오류 검사 |

## 다음 작업자의 검증 기록 양식

```text
작업 ID:
기준 SHA / 결과 SHA:
OS / Node / npm / Python:
실행 명령:
종료 코드와 핵심 결과:
실패 시 단계와 원인:
미실행 항목:
실제 외부 요청 / 과금 여부:
다음 작업:
```

UI 검증에는 가짜 세션·이미지·API 응답을 사용한다. 실제 생성 성공과 가짜 응답 검증을 구분한다. 저장·메타데이터 변경에는 이전 데이터 읽기와 원본 보존을 확인하는 검증이 필요하다.

## 경로만 확인하기

```sh
npm run profile:check -- /절대/개발프로필
```

Linux의 디스플레이 없는 환경에서 검증한 명령은 아래와 같다. 설정·토큰·서비스·창 초기화 전에 종료한다.

```sh
npm run profile:check -- /tmp/sdstudio-dev-profile --ozone-platform=headless --disable-gpu
```

인자를 생략하면 저장소 아래의 무시되는 개발 프로필 폴더를 사용한다. 환경변수를 직접 사용할 경우 `SDSTUDIO_USER_DATA_DIR`는 비어 있지 않은 절대 경로여야 한다. 전체 UI 검증에는 `npm run start:isolated -- /절대/개발프로필`을 사용한다.

원본 앱에서 저장 위치를 직접 변경했다면 그 사용자 지정 폴더 안에 개발 프로필을 두지 않는다. 원본 config를 읽지 않는 설계상 그 위치는 자동 탐지하지 않는다. Electron 실기 프로필 테스트는 합성 appData를 확실히 지정할 수 있는 Linux에서만 실행한다. 컨테이너에 필요한 추가 Electron 인자는 `SDSTUDIO_TEST_ELECTRON_ARGS`의 JSON 문자열 배열로 명시할 수 있으며 sandbox 비활성 플래그를 자동 추가하지 않는다. Windows npm ci는 미검증이며 sharp 0.32 계열의 libvips 바이너리는 설치 중 별도 다운로드된다.

## 오프라인 기동과 예제

`npm run start:isolated -- /절대/개발프로필`은 기본 오프라인이다. 온라인 검증이 필요한 작업에서만 `SDSTUDIO_OFFLINE=0`을 명시한다. 가짜 백엔드를 쓰는 `npm run start:mock`은 계정/API를 쓰지 않고 변경을 저장하지 않는다. 독립 브라우저 모드의 실기 검증은 아직 하지 않았다. 전체 창 검사는 X11 DISPLAY가 필요하며 `npm run smoke:offline`과 `npm run smoke:offline -- real`로 구분한다.


## 모델/API 초안 검증

`npm run test:nai-contract`는 독립된 메모리 초안을 합성 요청으로 투영하고 ZIP/PNG를 확인한다. 앱의 실제 계정·V3 전송·세션 저장은 호출하지 않는다. 입력·기대 출력은 `src/__tests__/fixtures/nai/`에 있고 모델 ID도 가짜다. 실제 지원 상태는 [NOVELAI_API.md](NOVELAI_API.md)를 기준으로 한다.


## 오프라인 새 화면

`npm run start:mock`은 브라우저 예제, `npm run start:preview -- /절대/개발프로필`은 Electron 개발 모드다. 새 화면은 mock 전용이며 기존 V3 화면에서 편집한 뒤 다시 미리보기로 돌아올 수 있다. 창을 닫으면 새 초안과 예제는 사라진다. [P1-01 검증과 화면](validation/2026-11-20-p1-workspace.md)을 참고한다.

P1-01b 작업실에서는 씬별 입력을 편집한 뒤 `전체 씬 예약` → `대기열 시작`으로 3씬 × 반복 2회의 기본 예제를 볼 수 있다. `중지`는 현재 예제 완료 후 멈추며 `계속`은 남은 예약만 실행한다. 예약 후 편집은 기존 예약을 바꾸지 않으므로 필요하면 명시적으로 `전체 예약 교체`를 누른다. 기본 시드는 매번 무작위이며 고정 모드에서는 0을 포함한 uint32 시드를 사용한다. 실패 작업은 자동 재시도하지 않는다. 창을 닫으면 씬·예약·결과가 사라진다. [검증·화면](validation/2026-11-21-p1-scene-queue.md).


## 로컬 패키지 범위 검사

`package:manifest`는 실제 디렉터리 패키지의 물리 파일과 ASAR 논리 항목을 SHA-256으로 기록한다. `smoke:package`는 Linux X11에서 실제 패키지 바이너리를 격리 오프라인 mock으로 실행한다. 검사 하네스를 loopback inspector로 진입 전에 주입하고 패키지 파일은 수정하지 않는다. 제품 실행·OS 지원/릴리스와 구분한다. [정확한 명령·한계](validation/2026-11-21-package-manifest.md)를 따른다.


## 고지 묶음

`npm run build`는 production main/preload·renderer 컴파일의 패키지 목록을 남기고 고지를 수집한다. `licenses:bundle`로 재수집할 수 있으며 beforePack에서도 자동 생성한다. `.erb/generated/notices`는 Git에서 제외한다. 패키지는 `package:check-notices`로 경로·사본 해시·번들/metadata 대응을 검사한다. `--require-notice-files`는 현재 원문 미확인 8건을 이유로 실패한다. 이 검사와 전체 재배포 조건 완료를 구분한다. [정확한 범위·명령](licenses/BUNDLE_NOTICES.md).


## 신규 인증·전송 검사 (P0-03b1)

- `npm run test:nai-main`: 합성 토큰·암호화 공급자/요청기로 보관·복구·취소·오류를 검사한다. 실제 자격증명은 불필요하다.
- `npm run build:main` 후 `npm run test:nai-main:electron`: Linux X11 DISPLAY가 필요하다. 임시 appData/userData, compiled preload, 불안전 키링 거부와 세션의 네트워크 차단/루프백 응답을 확인한다. `SDSTUDIO_TEST_ELECTRON_ARGS`는 기존 테스트와 같은 JSON 배열이다. 자동으로 sandbox를 해제하지 않는다.
- 이 절은 인증·전송 기반의 합성 검사다. 현재 새 작업실의 토큰 입력·실제 기본1장/반복 생성은 [사용자 로컬 확인](WORKSPACE_LIVE_CHECK.md)을 따른다. [범위·기한·복구](NAI_AUTH_TRANSPORT.md).


## 포크 기본 프로필과 토큰 설정 (P0-03b2 일부)

- 내부 이름/productName: SDStudio-HyunnJg. appId: io.github.hyunnjg.sdstudio. Linux 실행 파일: sdstudio-hyunnjg. 기본 userData: appData/SDStudio-HyunnJg. 이름·경로·ID는 토큰 보관 이후 유지한다.
- 첫 import에서 이름과 네 경로를 고정한다. 기본 프로필도 경로 격리 규칙을 사용하며 config.saveLocation은 무시한다. D-048 이후 설정이 없는 일반 포크는 온라인이고 명시적 개발 프로필은 기본 오프라인이다. 원본이나 초기 개발 프로필을 자동 이관하지 않는다. 기존 명시적 SDSTUDIO_USER_DATA_DIR 사용은 유지한다.
- API 토큰 창은 새/기존 데스크톱 화면에서 열린다. 오프라인/mock에서는 입력·조회가 비활성이다. 일반 포크의 온라인 선택은 아래 연결 모드 화면을 사용한다. 명시적 개발 프로필은 SDSTUDIO_OFFLINE=0을 사용한다. 예: Linux의 `SDSTUDIO_OFFLINE=0 npm run start:isolated`. 새 토큰은 기존 V3 로그인과 별도이고 새 작업실의 고정 기본1장/반복 생성에 사용한다.
- `npm run test:identity`, `npm run test:auth-ui`, `npm run test:nai-main`은 합성 단위 검사다. `npm run smoke:auth-ui` / `npm run smoke:auth-ui -- offline`은 Linux X11·빌드된 main/preload/renderer가 필요하다. synthetic appData를 만들고 네트워크 차단 하네스에서 합성 토큰 UI를 조작한다.
- `npm run smoke:package -- /absolute/linux-unpacked auth`는 실제 패키지의 기본 포크 경로·인증 화면을 같은 폐쇄된 환경에서 검사한다. 기본 mock/real 검사도 유지한다. inspector 주입·잠금 모의 한계는 이전과 같고 앱 아카이브 바이트는 바꾸지 않는다.


## 일반 포크의 연결 모드 (D-028)

환경변수 없이 일반 데스크톱 앱을 열면 최초에는 오프라인이다. API 토큰 창의 연결 모드에서 다음 시작 값을 저장하고 재시작한다. 저장만으로 현재의 네트워크/인증 차단은 풀리지 않는다. 재시작은 기존 V3 프로젝트 저장을 기다리며 예약·진행 중인 작업이나 저장 오류가 있으면 중단한다. 임시 초안·예제 기록과 세션 한정 토큰은 재시작 때 사라진다.

SDSTUDIO_MOCK_BACKEND=1, 명시적 SDSTUDIO_USER_DATA_DIR, SDSTUDIO_OFFLINE 지정 실행은 우선순위에 따라 고정된다. 개발 경로를 온라인으로 검증할 때만 SDSTUDIO_OFFLINE=0을 함께 지정한다. 정상 포크 프로필의 저장 설정은 개발 강제값을 덮어쓰지 못한다. 설정 파일 손상/미지원 버전은 오프라인으로 시작하고 화면에서 해당 설정 파일만 명시적으로 초기화한다.

데스크톱 V3 저장 위치 버튼은 적용되지 않는 값의 변경을 막기 위해 비활성화했다. 앱 데이터는 계속 포크 프로필에 둔다. 원본 프로필/토큰을 자동 가져오지 않는다. publish 대상은 HyunnJg/SDStudio의 draft이며 검증은 계속 --publish never로 한다.

```sh
npm run test:network-mode
npm run smoke:network-mode -- /absolute/linux-unpacked
```

두 번째 명령은 Linux X11과 실제 directory package가 필요하다. inspector는 루프백에만 열고 앱 번들 밖 하네스를 주입한다. 두 번의 실제 native relaunch를 관찰하며 앱 파일은 변경하지 않는다. Unix 소켓 제한 환경에서는 하네스의 단일 인스턴스 잠금 모의 처리를 사용한다. [검증 범위](validation/2026-11-21-network-mode.md).


## 메인 ZIP·PNG 응답 검증

`npm run test:nai-response`는 합성 PNG/ZIP로 크기 위조·CRC·손상·취소·기한과 sendImage의 서버 처리 불확실성을 검사한다. `npm run test:nai-main:electron`은 X11에서 실제 Electron net.request의 루프백 응답도 검사한다. 두 경로 모두 실제 자격증명을 쓰지 않는다. sendImage는 향후 신규 모델 연결용 내부 함수이며 기존 V3 생성 저장/PNG 경로를 대체하지 않는다.

기존 V3 로그인은 이메일·비밀번호로 받은 토큰을 평문 TOKEN.txt에 보관한다. 새 API 토큰 창과 별도임을 환경설정/상단에 표시한다. 온라인 선택 자체가 신규 모델 생성 연결 완료나 서버 인증 성공을 뜻하지 않는다.


## 응답 진단을 다시 확인할 때

`npm run nai:inspect-response -- /absolute/response.zip`은 개발 체크아웃에서 로컬 응답 하나를 읽기 전용으로 검사한다. API/토큰·원본 프로필을 조회하지 않으며 PNG/ZIP 내용을 출력하거나 저장하지 않는다. 성공은 종료 0, 형식/검증 실패는 1, 사용법/파일 읽기·사전 크기 제한 실패는 2다. 표준 출력 JSON에는 코드·고정 사유·바이트 개수만 있다. 원문 파일의 자동 수집·업로드는 없다. `npm run test:nai-response`가 같은 검사와 도구를 합성 파일로 검증한다.


## 1회 실호출 검증 도구 (D-032)

실제 요청을 보낼 수 있는 별도 개발 도구다. 일반 앱의 새 작업실 기본1장/반복 생성 확인은 [별도 절차](WORKSPACE_LIVE_CHECK.md)를 따른다. [전체 실험 계획](NAI_LIVE_VALIDATION.md)을 먼저 읽는다. **실험 창만 실행할 때는 루트 npm install/npm ci가 필요 없다.** tools/nai-validation의 고정된 작은 의존성 묶음만 설치한다. 앱의 C++ 모듈·sharp·electron-builder·서브모듈 빌드를 실행하지 않는다.

저장소 루트에서 Windows PowerShell:

```powershell
git fetch origin
git switch work/p0-live-recovery
git pull --ff-only
npm --prefix tools/nai-validation ci
npm --prefix tools/nai-validation start -- "$env:LOCALAPPDATA\SDStudio-Live-Test"
```

Linux 예:

```sh
npm --prefix tools/nai-validation ci
npm --prefix tools/nai-validation start -- /home/your-name/SDStudio-Live-Test
```

이미 전체 앱 의존성을 설치한 개발자는 기존 npm run nai:validate-live 명령도 사용할 수 있다. 새 경로는 자체 ts-node/TypeScript를 먼저 등록해 루트에 남은 부분 설치를 사용하지 않는다. Electron prebuilt 다운로드는 필요하지만 C++ 소스 컴파일은 없다. Node 호스트는 실행 파일을 시작하고 TypeScript는 Electron 안에서 처리한다. 이 경로의 깨끗한 설치/화면 기동은 Linux Node24.22.3/npm11.19.1에서 검증했다. 사용자가 Windows/Node26.13.1에서 공식 ZIP 수동 해제 후 창과 실제 API1회 응답을 보고했다. 이는 로컬 자동 Windows 검사나 정상 npm postinstall 재현 성공은 아니다. macOS는 미검증이다. [설치 복구](../tools/nai-validation/WINDOWS.md).

### Windows 전체 앱 설치 오류와 구분

2026-11-22 사용자 로그는 src/native의 node-gyp10.2.0-electron.1이 VS18/2026을 unknown version으로 거부한 것이다. 설치된 C++ workload가 없다고 확인된 오류가 아니다. 전역 node-gyp/npm을 갱신해도 로컬 @electron/node-gyp 호출이 자동으로 교체되지는 않는다. [공식 node-gyp 변경 이력](https://github.com/nodejs/node-gyp/blob/main/CHANGELOG.md#1210-2025-11-12)의 VS2026 지원 추가는12.1.0이다.

전체 앱 설치의 Node26/VS2026 호환성을 해결했다고 표시하지 않는다. 그 변경은 Electron rebuild·중복 node-gyp·sharp와 실제 Windows 산출물 검증까지 별도로 다룬다. **실험 창을 열기 위해 VS/Python 재설치나 루트 의존성 삭제를 요구하지 않는다.** 위의 독립 설치는 기존 파일/lock을 지우거나 강제 변경하지 않는다.

경로에는 기존 개인 데이터가 없는 전용 폴더를 지정한다. checkout 내부/상위·원본/포크 기본 프로필과의 중첩은 거부한다. macOS도 별도 절대경로가 필요하지만 미검증이다. Linux에서는 그래픽 세션이 필요하다.

창에서 Persistent API Token을 **직접** 입력해 이번 실행에만 보관한다. 채팅/터미널 인자/환경변수에 키를 넣지 않는다. 일반 앱에 저장한 토큰을 이 창이 자동으로 가져오지 않는다. 전체 요청 JSON을 확인하고 NovelAI 웹에서 동일 설정의 표시 비용·현재 잔액을 확인해 입력한 뒤 세 항목을 선택한다. 표시 비용 10 초과/확인 누락/잔액 부족이면 전송하지 않는다. `SDSTUDIO_OFFLINE`이 0 외 값으로 지정됐거나 mock이 켜져 있으면 이 도구도 전송·토큰 IPC를 거부한다. 해당 잠금을 창에서 풀지 않는다.

전송 뒤에는 결과 JSON을 확인하고 웹 잔액을 다시 기록한다. 성공 이미지는 선택한 프로필/live-validation/result.png에 원본으로 남는다. 받은 원문 response.zip은 metadata/오류 내용이 포함될 수 있는 비공개 파일이다. 공유할 때는 먼저 result.json의 정제된 필드만 확인하고 원문·이미지·토큰·계정값은 보내지 않는다. 같은 프로필 재실행도 2회 전송을 막는다. 중지·닫기는 AbortSignal로 요청을 중단하지만 서버 처리/과금 취소를 보장하지 않는다.

```sh
# 아래 검사는 합성 데이터/루프백만 사용한다.
npm run test:nai-live
npm run test:nai-live:electron
```

Electron 검사는 Linux X11에서 7경로를 실행한다. Windows/macOS, 실제 키링/실제 계정·비용 확인을 대신하는 검사가 아니다. 도구 실행은 사용자 PC에서 이루어지며 이 개발 환경이 사용자의 입력 토큰을 원격 수신하는 방식이 아니다.


### PR15 이후 실측 보완 실행 — 2회 완료 기록

이 절은 이미 완료한 두 번째 실측의 실행 방법이다. 추가 전송을 요청하는 지시가 아니다. 기본1장 실측은 [성공 기록](validation/2026-11-22-live-success.md)으로 종료했다. 설치 의존성이 바뀌지 않았다면 기존에 수동 복구한 Electron을 다시 지우는 npm ci는 필요 없다.

```powershell
git fetch origin
git switch work/p0-live-recovery
git pull --ff-only
npm --prefix tools/nai-validation start -- "$env:LOCALAPPDATA\SDStudio-Live-Test-02"
```

첫 프로필은 그대로 둔다. 첫 attempt.json의 displayedCost와 새 웹 표시 비용의 합계10 Anlas 이내, 동일 설정의 웹 비용·잔액 확인 후 추가1회만 진행한다. 값을 모르면 전송하지 않는다. [정확한 조건](NAI_LIVE_VALIDATION.md#첫-관찰과-수정-후-추가1회-규칙-d-034). 도구가 모든 프로필의 횟수/비용을 전역으로 추적하거나 서버 청구 상한을 강제하는 것은 아니다.

### Windows 전체 앱용 Node 버전 준비 (PR #16 후속)

전체 앱의 재현 기준은 `.nvmrc`의 **22.4.1**이다. 최신 권장 버전이나 전체 Windows 지원 인증을 뜻하지 않는다. 연구 도구가 이미 열리는 PC에서 이를 위해 복구한 Electron을 지우거나 연구 실험을 반복할 필요는 없다.

[Microsoft의 Windows Node 안내](https://learn.microsoft.com/en-us/windows/dev-environment/javascript/nodejs-on-windows)와 [NVM for Windows 공식 안내](https://docs.nvm-windows.com/)를 따라 버전 관리 도구를 준비한다. 기존 MSI Node와 버전 관리 도구의 PATH 충돌은 해당 공식 절차로 먼저 확인한다. NVM이 이미 준비됐다면 별도 PowerShell에서 다음처럼 전환한다.

```powershell
nvm install 22.4.1
nvm use 22.4.1
node --version
npm --version
where.exe node
```

`node --version`은 v22.4.1인지, 실제 node 경로가 선택한 관리 경로인지 확인한다. npm은 선택한 Node 설치에 포함된 버전을 사용하며 기존의 npm 11을 이 조합에 강제로 유지하지 않는다. 권한이 필요한 버전 전환은 공식 안내를 따른다.

이 단계만으로 **VS2026 탐지 실패가 고쳐지는 것은 아니다**. 사용자 로그의 로컬 @electron/node-gyp10.2.0-electron.1은 VS18/2026을 인식하지 못했다. 전역 node-gyp 갱신도 이 호출을 자동 교체하지 않는다. Windows 전체 npm ci 성공은 아직 재현하지 않았으며, Node 전환 직후 루트 재설치가 성공한다고 안내하지 않는다. 네이티브 도구 체인/재빌드 의존성을 별도 변경·검증한 뒤 전체 앱 설치를 진행한다. 지금은 VS/Python 재설치, 원본 데이터/lock 삭제, npm audit fix --force를 요구하지 않는다.

### VS2022 Build Tools 병행 설치는 선택적인 호환 후보

전체 앱을 Windows에서 빌드할 시점에, 의존성을 바꾸지 않는 후보로 **VS2022 Build Tools + C++를 사용한 데스크톱 개발**을 VS2026 옆에 설치하는 방법이 있다. [Microsoft 병행 설치 안내](https://learn.microsoft.com/en-us/visualstudio/install/install-visual-studio-versions-side-by-side?view=vs-2026)와 [VS2022 릴리스 목록](https://learn.microsoft.com/en-us/visualstudio/releases/2022/release-history)을 따라 2022/17 계열을 선택한다. VS2026을 지우거나 이미 작동하는 연구 도구를 다시 설치할 필요는 없다.

이 체크아웃의 @electron/node-gyp10.2.0-electron.1 find-visualstudio.js에는 17→2022 탐지 경로가 있다. 그러나 이 저장소의 Windows 전체 npm ci·Electron 재빌드·sharp 성공은 아직 미검증이다. Node22를 선택한 뒤 VS2022 설치를 **별도로 선택한 경우에만** 실패 단계가 바뀌는지 확인한다. 성공을 약속하거나 사용자에게 지금 재설치를 요구하는 절차가 아니다. 실패하면 원문 전체 대신 도구 버전과 실패 단계로 다음 도구 체인 변경 범위를 결정한다.

### 새 프로젝트 저장 기반의 합성 검사

```sh
npm run test:project
# Linux X11과 빌드된 preload가 있을 때
npm run test:project:electron
```

기존 V3 파일이나 개인 이미지를 입력하지 않는다. 새 IPC는 오프라인에서도 사용할 수 있으나 현재 화면의 저장/열기 버튼은 아직 미연결이다. [저장 형식과 후속 UI 범위](PROJECT_STORAGE.md).

### 프로젝트 조작 화면 검사 (D-039)

```sh
npm run test:project
npm run test:project-ui
# production main/preload/renderer + projectWorker 빌드 후 Linux X11
npm run smoke:project-ui
npm run smoke:workspace
```

smoke:project-ui는 빈 전용 프로필로 실제 Electron을 두 번 실행한다. UI 저장·닫기 취소·남은 잠금 복사·손상 이력 복구 뒤 실제 native close를 완료하고 다음 PID에서 목록을 열어 입력을 복원한다. 환경 단일 인스턴스 잠금만 모의하고 원격 요청을 차단한다. 합성 프로젝트와 임시 파일만 사용하며 종료 후 정리한다. 새 프로젝트 저장은 mock 작업실에서도 별도 IPC로 실제 비공개 프로필에 기록되므로 이전의 “모든 저장 없음” 배지와 구분한다.

production worker는 projectWorker.js를 추가 산출물로 빌드한다. 개발 TS worker에는 기존 루트 ts-node hook 경로를 지정하되 ts-node를 production 번들로 끌어오지 않는다. Node worker 단위 검사와 production Electron UI는 확인했지만 Windows/macOS·ASAR/패키지 실행·전체 dev 서버 재기동은 이번 검증 범위가 아니다.

### 프로젝트 worker·화면 중단 패키지 검사 (D-040)

위 D-039의 ASAR 미검증 상태는 [후속 실측](validation/2026-11-22-project-resilience.md)으로 Linux 디렉터리 패키지에 한해 보완했다. Windows/macOS는 계속 미검증이다. 빌드 후 패키지 경로를 지정해 `npm run smoke:package -- /absolute/linux-unpacked projects`로 실제 ASAR 내부 worker 저장/복구/닫기를 검사한다. 마지막 인자를 `worker`, `crash`, `unresponsive`로 각각 바꾸면 저장 worker 종료/수동 복구, 실제 renderer 강제 종료, 무응답 이벤트 주입을 검사한다. 네 모드는 Linux X11에서 순서대로 실행한다.

패키지 archive를 바꾸지 않고 loopback inspector로 테스트 하네스만 주입한다. native dialog 선택과 singleton 잠금은 모의이며 일반 제품 실행 옵션이 아니다. 하네스의 의도적 crash 외 renderer 오류/원격 요청은 실패다. 선택 `SDSTUDIO_PACKAGE_REPORT`는 정제 결과 JSON을 지정한 로컬 파일로 복사한다. 테스트 프로필은 임시 폴더이며 실제 사용자 파일을 입력하지 않는다.

운영에서 PROJECT_SERVICE_STOPPED가 보이면 입력을 유지한 채 저장 기능 다시 시작을 선택할 수 있다. 이전 쓰기는 다시 보내지 않으므로 목록/열기로 완료 여부를 확인한다. 잠금/부분 파일을 자동 삭제하지 않는다. 개발 TS worker는 시작 cwd와 관계없이 모듈 기준 hook/tsconfig를 사용한다.

### 기본1장 생성·PNG 저장 검사 (D-041)

```sh
npm run test:generation
npm run test:project-ui
npm run build
# Linux X11, 합성 토큰/루프백만 사용하며 실제 계정 호출 없음
npm run smoke:generation
npm run smoke:package -- /absolute/linux-unpacked generation
```

smoke:generation은 실제 앱3PID로 생성/취소/PNG 저장 실패 뒤 새 프로젝트 보관, 재열기, 오프라인 PNG 표시와 생성 거부를 확인한다. native net.request의 고정 주소를 테스트만 루프백으로 바꾸고 원격 요청은 차단한다. 공개 결과에는 합성 체크만 남긴다. 실제 key/PNG를 입력하지 않는다. 기본1장은 새 작업실 버튼으로 들어가고, 실제 계정 확인이 필요할 때만 사용자가 앱의 API 토큰 창에 직접 입력한다. 현재 새 UI의 실제 계정 호출은 미검증이다. [조건·오류·버전 호환](WORKSPACE_GENERATION.md).

Windows 첫 전체 앱 확인에는 Node22 기준/VS2022 Build Tools 선택지·npm ci를 먼저 구분하고, packaged 프로젝트 저장/PNG 재열기 및 무응답 창에 붙은 native dialog의 표시 위치·포커스·취소/버리기도 확인한다. Linux GUI 선택 모의가 Windows OS 모달 검증을 대신하지 않는다. 이번에 Windows 설치 문제를 해결하거나 다른 OS 지원 정책을 확정하지 않았다.


### PNG 읽기 횟수 회귀 검사 (D-042)

```sh
npm run test:project-reads
# 선택 사항: 합성 데이터의 읽기 횟수만 로컬 JSON으로 출력
SDSTUDIO_PROJECT_READ_REPORT=/tmp/project-reads.json npm run test:project-reads
```

PowerShell에서는 `$env:SDSTUDIO_PROJECT_READ_REPORT`에 임시 결과 경로를 먼저 지정하고 같은 npm 스크립트를 실행한다. 테스트가 임시 프로필·120개 서로 다른 합성 PNG를 만들고 정리한다. 선택 이미지의 참조/해시/크기, 생성 준비의 리비전/잠금/한도, 저장-only 재시도와 실제 TS worker 경계를 검사한다. 파일 open 횟수 측정이며 256 MiB 지연 benchmark가 아니다. 실제 키·계정 호출은 필요 없다. [실행 기록](validation/2026-11-23-project-reads.md).


### 실제 기본 씬·반복 큐 합성 검증 (D-043)

```sh
npm run test:generation-queue
npm run build
# Linux X11 / 실제 계정 호출 없이 합성 토큰·loopback 응답
npm run smoke:generation-queue
npm run smoke:package -- /absolute/linux-unpacked generation-queue
```

smoke:generation-queue는 production 앱의3개 PID로 선택3씬×2회·묶음 확인·중지 후5건 재확인·저장 실패 결과의 새 프로젝트 보관·재열기/오프라인 표시를 확인한다.13회는 하네스의 loopback HTTP 횟수이고 계정 API 호출은0이다. 정상 단일 생성은 기존 smoke:generation으로 계속 검사한다. 선택 SDSTUDIO_GENERATION_REPORT/SDSTUDIO_GENERATION_SCREENSHOT는 합성 검증 JSON/화면만 로컬 경로에 남긴다. 패키지의 generation-queue 모드도 inspector 하네스·singleton/좁은 폭 대체 조건을 사용한다. [검증/한계](validation/2026-11-23-connected-queue.md).


D-044 후속: test:generation-queue는 큐25 + presentation3 검사를 함께 실행한다. 미전송 입력 범위·전송 전 실패 복구·named conflict·삭제 ID 정리가 추가됐다. smoke:generation-queue는 기존13회 loopback 시나리오에 “다른 씬 보기/프로젝트 이름 변경 → 예약 입력 변경 거부/원복 → 같은5건 확인”을 포함해3PID10체크다. package의 generation-queue도8체크를 요구한다. 실제 계정 호출 없이 검사하며, [검증](validation/2026-11-23-queue-resume.md)에 한계를 기록했다.


### 이번 중단 원인·충돌 제외 검사 (D-045)

```sh
npm run test:generation-queue
npm run build
# Linux X11, synthetic tokens/loopback only
npm run smoke:generation-errors
npm run smoke:package -- /absolute/linux-unpacked generation-errors
```

queue-errors 하네스는429→이어가기 성공/다음 TIMEOUT→다음 이어가기 결과 저장 실패→새 프로젝트 보관→충돌 씬2건 제외/나머지2건 재확인 취소를 확인한다. 상태 폴링 응답을 일부러 보류하고 네트워크90초 timer를 테스트에서만900ms로 줄인다(제품 기한 변경 없음). 실제 계정 요청0이며4회는 loopback HTTP 횟수다. 기존 smoke:generation-queue 모드는 변경 없이 유지한다. [검증/실패 후 보완/한계](validation/2026-11-23-queue-stop-cause.md).


## 새 작업실 실계정 확인 (D-046)

[전체 앱 기동 → 기본1장 저장/재열기 → 같은 씬2회](WORKSPACE_LIVE_CHECK.md) 순서다. 연구 창을 다시 실행하지 않으며 키는 앱 토큰 창에 직접 입력한다. 설치가 막힌 경우에는 이 절차를 중단하고 현재 실패 단계를 확인한다. 이번 오류 정리의 [검증 범위](validation/2026-11-23-workspace-live-check.md)는 관련63건·메인 빌드이며 새 UI/ASAR·Windows·실계정 검증을 수행한 것으로 표시하지 않는다.

## Windows: production 빌드는 성공했는데 npm start가 DLL에서 멈출 때

`build:main`·`build:renderer`가 종료0이어도 개발 실행용 `.erb/dll/renderer.json`은 별도다. 이전 시작 설정은 DLL이 없을 때 `postinstall` 전체를 다시 실행하고 실패 출력을 Buffer로 숨겼다. 자동 복구를 `build:dll` 한 단계와 상속 출력으로 수정했다. 기존 main에서도 다음 수동 명령으로 DLL 단계를 분리할 수 있다.

```powershell
npm run build:dll
if ($LASTEXITCODE -eq 0) {
    npm start
}
```

DLL 빌드가 실패하면 먼저 그 오류를 확인하고 앱 시작으로 넘어가지 않는다. `npm run postinstall` 전체를 반복하거나 루트 의존성을 다시 지울 필요는 없다. DLL 성공은 전체 앱의 Electron 실행 파일/네이티브 모듈 준비 완료를 보장하지 않는다.

```powershell
Test-Path .\node_modules\electron\dist\electron.exe
Test-Path .\tools\nai-validation\node_modules\electron\dist\electron.exe
```

첫 번째는 전체 앱, 두 번째는 연구 도구다. 연구 도구의 ZIP 복구가 첫 번째 경로를 복구하지는 않는다. 첫 번째가 False이거나 다음 시작이 실패하면 그 단계만 확인한다. API 토큰은 설치/시작 진단에 필요 없다.

사용자 npm11.21.3 로그는 `electron@26.6.10`의 postinstall이 승인되지 않았다고 명시했다. [npm 공식 설명](https://docs.npmjs.com/cli/v11/commands/npm-install-scripts/)의 `npm install-scripts ls`는 설치 스크립트 정책을 읽기 전용으로 확인한다. 연구 도구만 확인할 때는 `npm --prefix tools/nai-validation install-scripts ls`다. 승인 정책을 검토 없이 전체 허용으로 바꾸지 않는다. 과거 Electron 설치 실패 전부가 이 정책 때문이었다고 소급 단정하지 않는다. 이번 Windows production 빌드 성공도 전체 npm ci·앱 기동·Node26/VS2026 호환 인증으로 확대하지 않는다.

[재현·범위](validation/2026-11-23-dev-dll-start.md).


## V5 설정·간단한 생성 (D-048)

새 작업실은 V5 Full portrait를 기본으로 한다. npm run test:generation-v5는 실제 계정 없이 binding/body hash/혼합 큐·v3 저장과 v1 복구·저장-only 복구를 확인한다. npm run build는 production main/preload/worker/renderer와 고지를 만든다. 이번 변경은 Electron26/Node22.4.1 재현 기준을 갱신하지 않는다. 사용자의 Node26 로컬 기동 보고와 이 Linux 검증을 구분한다.

일반 새 프로필은 online으로 시작한다. 기존 saved offline은 유지하고 API 토큰 창에서 변경/재시작할 수 있다. npm run start:isolated와 mock·SDSTUDIO_OFFLINE 지정은 기존 우선순위를 유지한다. 새 native 재시작 검사는 저장된 offline fixture로 시작해 사용자 선택 유지→online→offline을 검사한다.

Node/Electron 현대화 후속은 지원 중인 Electron/내장 Node와 개발 호스트 Node를 함께 정하고, electron-rebuild/node-gyp/sharp/sdsnative ABI·Windows VS 탐지·npm 설치 스크립트 정책·개발 DLL/worker·production 패키지·프로필/암호화 저장 회귀를 별도 검증한다. 특정 새 조합을 검증 없이 지원 버전으로 선언하거나 정상 로컬 설치를 지우지 않는다.


## Windows 로컬 기동 보고와 역할 구분 (D-049)

사용자가 전달한 Codex 결과는 [별도 기록](validation/2026-11-24-windows-local-start.md)에 보존했다. 앱 개발 실행은 전용 Node22.4.1/npm10.8.1, native 빌드 도구는 Node26/node-gyp12.1.0, 대상은 Electron26.6.10이며 VS2026/Python3.14.3 경로로 성공했다고 보고했다. 이는 기존 자동 재빌드나 루트 clean npm ci·Windows 패키징 성공이 아니다. 정상 로컬 활성화 스크립트/런타임/lock 변경을 지우거나 VS2022 설치를 다시 요구하지 않는다. main 업데이트 전 git status로 로컬 변경을 확인하고 별도 브랜치에 보존한다.
