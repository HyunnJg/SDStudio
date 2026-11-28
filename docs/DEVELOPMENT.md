# 개발 시작과 검증 기록

## 현재 데스크톱 설치 기준 — D-050

Node **26.13.1**, npm **11.21.3**, Electron **45.4.1**로 갱신했다. 개발 명령은 Node26에서, 앱은 Electron 내부 Node24.22.3에서 실행된다. Node22 전용 셸이나 전역 node-gyp를 따로 구성하지 않는다. 아래 절차가 현재 기준이며, 뒤의 과거 조사 기록은 당시 환경을 뜻한다. [변경·검증 범위](RUNTIME_MODERNIZATION.md).

이미 실행되는 로컬 체크아웃은 그대로 보존하고 다른 폴더에 새 체크아웃을 만든다. 사용자 프로필·토큰·프로젝트·`.sdstudio-runtime`·기존 lock을 지울 필요가 없다. 새 체크아웃을 설치하는 동안 기존 앱은 닫아 둔다.

### 처음 실행하기 전: 코드 폴더와 사용자 데이터는 별개

체크아웃을 새 폴더에 받아도 일반 실행은 기존 `%APPDATA%\SDStudio-HyunnJg`를 쓴다. Chromium 캐시·Local Storage/IndexedDB·설정·암호화 토큰·프로젝트가 그 안에 있으므로 **Electron45로 일반 프로필을 열기 전에 앱을 모두 닫고 이 폴더 전체를 별도 위치에 백업한다.** 명시적 사용자 데이터 경로를 썼다면 그 실제 경로를 백업한다. 소스 폴더만 보존한 것은 프로필 백업이 아니다.

기본 Windows 프로필을 쓰는 경우의 수동 백업 예시다. 여기서 사용자의 백업을 대신 실행하거나 확인한 것은 아니다. 복사본은 계정 자료를 포함하므로 외부에 공유하지 않는다.

```powershell
$profileRoot = Join-Path $env:APPDATA 'SDStudio-HyunnJg'
$backupRoot = Join-Path $env:LOCALAPPDATA ('SDStudio-Profile-Backup-' + [guid]::NewGuid().ToString('N'))
if (Test-Path -LiteralPath $profileRoot) {
    Copy-Item -LiteralPath $profileRoot -Destination $backupRoot -Recurse -ErrorAction Stop
}
```

첫 기동 시험은 아래처럼 체크아웃 밖의 **별도 개발 프로필**로 한다. 이 프로필은 기본 오프라인이며 기존 토큰/프로젝트를 자동 복사하지 않는다. 일반 앱의 온라인 기본값은 바꾸지 않는다.

```powershell
git clone --branch main https://github.com/HyunnJg/SDStudio.git SDStudio-modern
cd SDStudio-modern
git submodule update --init externals/capacitor-background-mode
node --version
npm --version
npm ci --include=optional
npm run verify:desktop
npm run build
npm run start:isolated -- "$env:LOCALAPPDATA\SDStudio-Modern-Test"
```

위 명령은 PR29 병합 후 main 기준이다. PR 검토 중에는 clone의 --branch를 해당 PR 브랜치로 바꾼다. 별도 프로필에서 창·저장·이미지 복사를 확인하고 일반 프로필을 백업한 뒤에만 `npm start`로 평소 데이터를 연다.

**새 Electron으로 연 일반 프로필을 Electron26 체크아웃으로 다시 열지 않는다.** 되돌릴 때는 앱을 모두 닫고, 업그레이드 뒤 프로필과 새 결과를 별도로 보존한 뒤 백업 전체를 복원한다. 복원은 백업 시점으로 돌아가는 작업이며 백업 이후 편집/결과를 자동 병합하지 않는다. 새 저장 형식(v3)을 모르는 옛 앱은 해당 프로젝트를 열 수 없다는 점도 별개다. 이 앱의 E45→E26 프로필 다운그레이드는 검증하지 않았다.

Node/npm 버전이 다르면 먼저 선택한 설치의 PATH를 확인한다. npm만 맞출 때는 `npm install --global npm@11.21.3 --ignore-scripts`를 사용한다. npm12 새 버전 안내만 보고 올리지 않는다. 이미 올렸다면 같은 명령으로 npm11.21.3을 다시 선택한다. Windows에는 Python과 Visual Studio C++ 데스크톱 워크로드/Windows SDK가 필요하다. 기존 VS2026/Python 설치를 그대로 사용하고, 필요하면 해당 셸에서 `$env:npm_config_python = 'C:\실제경로\python.exe'`로 Python을 지정한다. 새 node-gyp12.2는 Windows CI에서 실제 VS2026 Enterprise/Python3.15.2 탐지·빌드에 성공했다. 사용자 Windows10/Community 설치와 실제 GUI 확인까지 대신한 것은 아니다.

`npm ci`의 루트 postinstall이 자식 lock 설치 → 명시적 Electron 다운로드 → Electron 헤더 대상 native 빌드 → 실제 바이너리 확인 → 개발 DLL 빌드를 순서대로 수행한다. npm11의 외부 설치 스크립트 기본 차단에 기대지 않는다. 자세한 허용 목록은 package.json의 allowScripts와 변경 문서를 참고한다. 루트 `--ignore-scripts` 설치만으로 앱이 준비됐다고 보지 않는다. 의도적으로 설치 스크립트를 생략했다면 이후 `npm run setup:desktop`을 실행한다. 재빌드만 필요하면 `npm run rebuild`다. 설치 실패와 앱 실행을 연달아 진행하지 않고 실패 단계부터 해결한다.

- `npm run verify:desktop`: 실제 Electron에서 sdsnative 검색과 sharp PNG/알파 왕복 검사. 계정·프로필·네트워크를 사용하지 않는다.
- `npm run test:unit`: CJS 단위 회귀. Electron 창 검사는 별도다.
- `npm run build`: main/preload/worker/renderer와 고지 생성.
- `npm start`: 개발 서버와 Electron 창. 포크 기본 프로필은 원본과 별개이며 일반 실행은 온라인이다. 원격 호출 없는 확인에는 아래 격리 오프라인 명령을 사용한다.
- `npm run start:isolated -- <절대 경로>`: 별도 개발 프로필에서 기본 오프라인 실행.
- `npx electron-builder --dir --publish never`: 현재 OS 디렉터리 패키지. 서명/공개 배포가 아니다.

데스크톱 file 의존성인 background-mode만 초기화하면 된다. Android/iOS 및 Python/BiRefNet 패키징은 이번 범위에 포함하지 않는다. 기존 원본 config·토큰·세션을 테스트 프로필로 복사하지 않는다.

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

원본 앱에서 저장 위치를 직접 변경했다면 그 사용자 지정 폴더 안에 개발 프로필을 두지 않는다. 원본 config를 읽지 않는 설계상 그 위치는 자동 탐지하지 않는다. Electron 실기 프로필 테스트는 합성 appData를 확실히 지정할 수 있는 Linux에서만 실행한다. 컨테이너에 필요한 추가 Electron 인자는 `SDSTUDIO_TEST_ELECTRON_ARGS`의 JSON 문자열 배열로 명시할 수 있으며 sandbox 비활성 플래그를 자동 추가하지 않는다. Windows clean 설치 결과는 현대화 검증 기록을 따른다. sharp0.35의 플랫폼 바이너리는 optional npm 패키지로 설치되므로 optional 의존성을 제외하지 않는다.

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

`npm run build`는 production main/preload·renderer 컴파일의 패키지 목록을 남기고 고지를 수집한다. `licenses:bundle`로 재수집할 수 있으며 beforePack에서도 자동 생성한다. `.erb/generated/notices`는 Git에서 제외한다. 패키지는 `package:check-notices`로 경로·사본 해시·번들/metadata 및 Electron·Chromium 원문을 대조한다. Windows x64 D-089 후보에서 `--require-notice-files`는 native ISC 원문 1건 때문에 실패한다. 이 검사와 전체 재배포 조건 완료를 구분한다. [정확한 범위·명령](licenses/BUNDLE_NOTICES.md).


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

### 이전 Node22·VS2022 우회 안내는 D-050으로 대체

PR16/17 당시에는 Node22.4.1 재현과 VS2022 병행 설치를 후보로 안내했다. 현재 경로는 위 Node26/Electron45 설치이며 VS2022 추가 설치를 전제로 하지 않는다. 당시 사용자 오류와 실제 로컬 복구는 [Windows 기동 기록](validation/2026-11-24-windows-local-start.md)에 보존한다.

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
