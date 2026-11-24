# 데스크톱 런타임 현대화 — D-050

2026-11-24 (Asia/Seoul), 기준 main `fd42ea3`. 사용자는 생성 실험보다 설치/실행 병목을 먼저 제거하도록 순서를 바꿨다. 기존 정상 Windows 폴더와 로컬 Codex 변경을 보존하고 별도 깨끗한 worktree에서 구현했다. 실제 계정 호출은 0회다.

## 버전과 역할

| 항목 | 이전 | 이번 고정 기준 |
| --- | --- | --- |
| 개발 호스트 Node | 22.4.1, 로컬 별도 Node26 빌드 우회 | 26.13.1 LTS |
| npm | 루트 npm 의존성이 실제 CLI를 가릴 수 있음 | 11.21.3, 루트 npm 의존성 제거 |
| Electron | 26.6.10 | 45.4.1 stable |
| 앱 내부 Node / modules ABI | 18 계열 | 24.22.3 / 150 (실행 실측) |
| rebuild | electron-rebuild3와 @electron/node-gyp10 혼재 | @electron/rebuild4.2.1 |
| node-gyp | VS2026 미탐지10 계열 | 12.2.0 (직접/재빌드 공유) |
| builder | 24 계열 | 26.18.0 |
| 런타임 sharp / libvips | 0.32.6 / 8.14.5 | 0.35.5 / 8.18.7 (설치 실측) |
| Node 타입 | 오래된20 계열 | 24.19.2 (앱 내부 런타임 기준) |

호스트와 Electron 내부 Node는 같은 버전일 필요가 없다. C++ native는 Electron45 헤더로 빌드하고 실제 Electron에서 로드한다. node-addon-api8 기반 소스/DB 검색 의미는 바꾸지 않았다. 최신 node-gyp13을 강제하지 않고 @electron/rebuild의 ^12.2.0 범위에 맞췄다. 개발/선택 로컬 AI의 @xenova/transformers가 갖는 sharp0.32.6은 이번 제품 sharp 갱신과 별개로 남아 있다. 모든 전이 의존성이 최신이거나 취약점0이라는 주장이 아니다.

## 설치 경로 하나

루트 preinstall은 도구 버전만 검사한다. postinstall의 setup-desktop은 순서대로 자식 lock 설치(스크립트 생략·optional 포함), 공식 install-electron, 로컬 node-gyp의 Electron 대상 C++ 빌드, src/node_modules 링크 확인, 실제 Electron native/sharp 왕복 확인, DLL 빌드를 실행한다. 전역 node-gyp·이전 Node22 셸·src/native 선행 host 빌드에 기대지 않는다. 실패 출력은 그대로 표시하고 다음 단계로 넘어가지 않는다.

npm11.21.3은 외부 의존성 스크립트를 기본 차단한다. Electron45의 명시적 install-electron을 직접 호출하므로 오래된 postinstall 승인/다운로드 생략 환경변수에 의존하지 않는다. 검토한 allowScripts는 개발 트리의 정확한 sharp0.32.6 설치만 허용한다. @parcel/watcher, esbuild는 제공되는 플랫폼 패키지를 사용하고, core-js/core-js-pure, exifreader, protobufjs, swiftlint, electron-winstaller의 불필요한 소스빌드/홍보/선택 플랫폼 hook은 실행하지 않는다. 전체 스크립트 허용은 추가하지 않았다. runtime sharp0.35는 optional 플랫폼 패키지로 설치한다.

기존 주석 처리된 electron-rebuild/check-native-dep와 별도 link-modules 진입점은 사용처 확인 후 제거했다. builder 패키징은 자신의 @electron/rebuild를 정상 실행하며 npmRebuild를 끄지 않았다. 같은 native 빌드 폴더를 갱신하므로 패키징과 앱 실행 검증을 동시에 하지 않는다.

## 개발 TypeScript 진입점

Electron45 내부 Node24의 default app loader가 main.ts를 native ESM으로 import해 ts-node의 CommonJS 훅을 건너뛰었다. 실제 npm start에서 profileBootstrap 확장자 해석 실패를 재현했다. 루트 main을 start-main.cjs로 바꾸고, 그 파일에서 ts-node를 등록한 뒤 main.ts를 require한다. 앱/프로필 위치는 저장소 루트 그대로이며 production release/app의 main 엔트리는 그대로다. Node 타입 제거 옵션이나 사용자별 NODE_OPTIONS로 우회하지 않는다.

## 바뀐 Electron API와 고지

Electron44 이후 이미지 클립보드는 비동기 clipboard.write/ClipboardItem API를 사용한다. 실제 IPC 복사 → clipboard.read → PNG 복호화로 확인한다. sandbox preload는 이미 Electron IPC/웹 API만 사용하므로 Node shim 제거를 이유로 sandbox를 해제하지 않았다. 하네스 console-message의 새 details 객체를 사용해 렌더러 오류 포착을 유지한다.

sharp의 @img 플랫폼 패키지와 libvips를 ASAR 밖에 유지하고, 해당 README/versions.json을 고지 증거에 포함한다. Windows의 @img/sharp-win32-*는 libvips를 같은 패키지에 담으므로 그 README/versions도 포함한다. README의 라이선스 표를 허가 전문으로 꾸미지 않는다. 앱/자산/DB 출처 및 미확인 고지8건은 공개 배포 전 과제다. 개수는 같지만 구성은 바뀌었다. 새 @img/sharp-libvips-linux-x64는 전문 미확인이고 이전 beep-boop 예제 metadata는 이번 패키지에 없다.

## 검증과 남은 범위

[실행 기록](validation/2026-11-24-runtime-modernization.md)을 따른다. Linux의 깨끗한 npm ci·실제 개발 실행·디렉터리 패키지·worker/프로필/저장·전송 합성 회귀를 확인한다. Windows CI는 같은 명령을 windows-2025와 ubuntu-24.04에 구성했고, [두 job 모두 성공](https://github.com/HyunnJg/SDStudio/actions/runs/45344459034)했다. CI의 Windows Server2025와 사용자의 Windows10 실제 GUI를 구분한다. macOS/서명/설치 프로그램/실제 OS 키링/NAI 계정 실험은 이번 범위 밖이다.

Linux sharp는 upstream이 문서화한 Electron/전역 GLib 충돌 경고와 GLib critical을 출력했다. 합성 PNG/알파 처리와 GUI 확인이 통과한 사실만 기록하며, 경고를 숨기거나 Linux의 모든 이미지 포맷이 안전하다고 일반화하지 않는다. 원격서비스와 무관한 로컬 런타임 한계다. 동기 safeStorage API도45에서 deprecated 경고가 남지만 아직 동작한다. 암호화 파일/복구 정책을 바꾸는 비동기 전환은 이번에 섞지 않았으며 제거되는 버전으로 올리기 전에 별도 회귀가 필요하다.

기존 자동 release/Pages/Local AI push 작업은 이번 런타임 검증에서 실행하지 않도록 수동 진입으로 분리했다. 새 desktop CI는 읽기 권한으로 빌드/검사만 하고 --publish never를 사용한다. 릴리스 fuse·서명은 후속 배포 작업이다.

## 확인한 공식 출처

2026-11-24 확인, 구현 코드를 복사하지 않고 버전/호환 API와 문서만 참고했다.

- [Node 지원 주기](https://nodejs.org/en/about/previous-releases), [Node26.13.1 배포](https://nodejs.org/dist/v26.13.1/)
- [Electron 릴리스](https://releases.electronjs.org/), [Breaking changes](https://www.electronjs.org/docs/latest/breaking-changes), [Clipboard API](https://www.electronjs.org/docs/latest/api/clipboard)
- [Electron rebuild](https://github.com/electron/rebuild), [node-gyp Windows 안내](https://github.com/nodejs/node-gyp#on-windows)
- [npm 설치 스크립트 정책](https://docs.npmjs.com/cli/v11/commands/npm-install-scripts/)
- [sharp 설치/ASAR/GLib 한계](https://sharp.pixelplumbing.com/install/)

## PR29 검토 반영

소스 폴더를 새로 받아도 기본 사용자 프로필을 공유하므로 전체 프로필 백업·별도 개발 프로필 기동·다운그레이드 시 백업 복원을 [설치 안내](DEVELOPMENT.md)에 명시했다. Electron46은 비동기 safeStorage/이전 암호문 회귀 전까지 설치 gate로 차단한다. npm12를 설치했다면11.21.3으로 복귀한다. 빈 이미지 복사 거부와 기존 클립보드 보존도 확인한다. 원본 프로필/실제 키링/실계정에 대한 사용자 PC 검증을 대신하지 않는다.
