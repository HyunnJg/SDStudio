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
