# 원본 구조와 변경 지점

조사 기준: `sunho/SDStudio@f2088add103ad683a31e0590448e6e5bb4d71556`.
정적 소스 조사이며 실행 결과가 아니다.

| 영역 | 주요 파일 | 역할 / 검토 지점 |
| --- | --- | --- |
| 앱 진입 | `src/renderer/index.tsx` | 렌더러 시작 |
| 화면 골격 | `src/renderer/componenets/App.tsx` | 상단바·프리셋·탭·하단 대기열 및 전역 대화상자 조립 |
| 생성 설정 | `PreSetEdtior.tsx`, `SceneEditor.tsx` | 위 `componenets` 디렉터리의 설정·씬 편집 UI |
| 씬·생성 대기열 UI | `SceneQueueControl.tsx`, `TaskQueueControl.tsx` | 위 `componenets` 디렉터리의 씬 및 진행 상태 조작 |
| 결과·편집 | `ResultViewer.tsx`, `ImageHistory.tsx`, `InPaintEditor.tsx`, `Tournament.tsx` | 위 `componenets` 디렉터리의 이미지 확인·선별·리터칭 |
| 상태·서비스 조립 | `src/renderer/models/index.ts`, `AppService.ts` | 서비스 인스턴스와 앱 상태. 모듈을 읽는 것만으로 시작되는 동작 주의 |
| 생성 실행 | `src/renderer/models/TaskQueueService.ts`, `models/workflows/` | 작업 실행·시드 진행·워크플로 |
| 프롬프트·저장 | `src/renderer/models/PromptService.ts`, `SessionService.ts`, `ResourceSyncService.ts` | 프롬프트 처리와 JSON 자원 저장 |
| 이미지 처리 | `src/renderer/models/ImageService.ts` | 이미지와 메타데이터 처리 점검 위치 |
| 플랫폼 경계 | `src/renderer/backend.ts`, `backends/electronBackend.ts`, `backends/androidBackend.ts` | 파일·생성·플랫폼 기능의 인터페이스와 구현 |
| NovelAI 요청 | `src/renderer/backends/genVendors/nai.ts`, `backends/imageGen.ts` | 모델·샘플러 매핑, 요청 구성, ZIP 응답 처리 |
| Electron | `src/main/main.ts`, `preload.ts`, `config.ts` | 로컬 파일·설정·IPC·앱 수명 |
| 네이티브 | `src/native/` | C++/node-gyp 기반 태그 관련 모듈 |
| 선택 기능 | `src/localai/`, `externals/`, `android/`, `ios/` | 로컬 AI 및 모바일 통합. 초기 UI 변경과 분리해서 조사 |
| 빌드 | `package.json`, `release/app/package.json`, `.erb/` | 루트/배포 의존성 및 webpack/Electron 빌드 |

위 표의 축약 파일명은 직전 셀의 전체 디렉터리를 따른다. 원본의 `componenets`, `PreSetEdtior`, `TobBar` 오탈자를 포함해 경로를 그대로 사용한다.

## 화면 변경 경계

첫 화면 변경은 기존 서비스와 저장 객체를 유지한 채 `App.tsx` 주변의 조립과 표시를 작게 바꾸는 방향을 권장한다. 모델/API 교체와 세션 스키마 개편을 같은 PR에 넣으면 회귀 원인을 구분하기 어렵다.

단순 브라우저로 열면 `models/index.ts`의 `window.electron == null` 분기에서 Android 백엔드를 선택한다. 웹 브라우저 미리보기를 만들려면 가짜 백엔드 주입 경로부터 마련해야 한다.

## P0에서 확인할 구체적인 항목

1. **모델 매핑:** `nai.ts`가 Anime/I2I를 `nai-diffusion-3`, Inpaint를 `nai-diffusion-3-inpainting`으로 매핑한다. Furry 분기도 V3이다. 최신 모델 지원을 확인한 상태가 아니다.
2. **IP 확인:** `TaskQueueService.ts`의 생성 핸들러는 `https://ip.sunho.kim`에 `uuid` 헤더를 보낸다. 호출은 모바일 조건문 밖에 있고, IP 변경 처리만 모바일 분기에 있다. 필요성과 포크에서의 대체·제거 방향을 검토한다.
3. **업데이트:** `AppUpdateNoticeService.ts`는 원본 릴리스를 조회한다. 생성자와 `models/index.ts` 양쪽에 `run()` 호출이 있고 각 호출이 루프를 시작한다. 중복 시작 경로는 소스로 확인했으며 실행 시 요청 횟수는 미실측이다. `App.tsx`의 다운로드 안내와 루트 `package.json`의 `build.publish`도 원본을 참조한다.
4. **자격증명:** `LoginService.ts` 및 백엔드는 `TOKEN.txt`를 사용한다. 테스트는 가짜 값으로 수행한다.
5. **기존 테스트:** `src/__tests__/App.test.tsx`는 기본 export를 import하지만 `App.tsx`는 named export를 제공한다. 원본 테스트를 현재 동작의 증거로 볼 수 없다. 루트에 `test` 스크립트도 없다.
6. **CI:** `.github/workflows/build.yml`은 여러 OS 패키징과 릴리스 초안 생성, `static.yml`은 저장소 전체 Pages 업로드, `build-local-ai.yml`은 별도 Python 빌드를 정의한다. 초기 문서 작업에서 실행하거나 재설정하지 않았다.

## 독립 검토 후 추가 확인

- **데이터 경로:** `src/main/main.ts`에서 `DEFAULT_APP_DIR = app.getPath('userData') + '/SDStudio'`이며, 이곳의 config를 읽은 뒤 `config.saveLocation`이 있으면 `APP_DIR`을 다시 선택한다. 개발 프로필 분리는 최초 config 읽기 전에 적용해야 한다. 원본 설치본과 실제 경로 충돌은 실행으로 확인하지 않았다.
- **기존 랜덤 조각:** `PromptService.ts`의 `parseWord()`가 `<모음.조각>`을 전개하고 `multi`를 `PromptRandomNode`로 만든다. `lowerPromptNode()` → `pickRandom()`은 `Math.random()`을 사용하며 전달받는 시드가 없다. 새 와일드카드 도입과 기존 기능 개선을 구분한다.
- **UI 최소 변경:** `App.tsx`의 전역 리스너·세션 동기화 수명을 보존하면서 작업영역을 기존 컴포넌트로 조립한다. 가짜 백엔드는 `models/index.ts`의 선택 지점부터 넣되, 전역 서비스와 `nai.ts` 사이 순환 참조를 함께 확인한다.

## 외부 요청·로컬 AI 시작 경로

아래는 이번 검토 범위에서 확인한 경로다. 저장소 전체의 완전한 네트워크 목록은 아니다.

| 위치 | 대상 / 동작 | 발생 조건과 상태 |
| --- | --- | --- |
| `TaskQueueService.ts` | `https://ip.sunho.kim`, `uuid` 및 고정 Authorization 헤더 | 생성 전에 호출. 모바일에서만 결과 활용. 데스크톱 호출 제거 예정 |
| `AppUpdateNoticeService.ts`, `App.tsx` | 원본 GitHub 릴리스 API 및 릴리스 페이지 | 서비스 시작 시 조회 루프. 링크는 사용자 동작으로 열림 |
| `LocalAIService.ts`의 `download()` | `https://huggingface.co/mathneko/localai/resolve/main/LocalAI-${platform}.zip?download=true`, `https://github.com/sunho/BiRefNet/releases/download/sdstudio/quality` | 다운로드 메서드 실행 시 바이너리·가중치 취득. import만으로 다운로드되는 것은 아님 |
| `models/index.ts` → `LocalAIService.statsModels()` | 로컬 파일 확인, 조건 충족 시 로컬 AI 프로세스 시작 | import 시 statsModels가 호출됨. 실행 파일과 quality 모델이 있으면 spawn 경로로 연결 |
| `backends/genVendors/nai.ts` | `api.novelai.net`, `image.novelai.net` | 기존 로그인·계정/생성 요청. 현행 공식 규격과 일치하는지는 P0-03 조사 대상 |

가짜 백엔드 모드에서는 위 외부 요청 및 로컬 프로세스 시작을 통제한다. 실제 생성 모드에서 필요한 NovelAI 통신까지 없앤다는 의미는 아니다.

## 현재 포크의 P0-02 변경

원본 조사와 구분한다. `src/runtimeOptions.ts`가 실행 정책을 정하고 preload는 필요한 두 플래그만 렌더러에 전달한다. `src/renderer/runtime.ts`가 가짜/Electron/Android 백엔드를 고른다. `backends/mockBackend.ts`는 파일·생성 픽스처를 메모리에 보관한다.

데스크톱 IP 확인을 제거했고 업데이트는 기본 비활성·중복 시작 방지이며 포크를 가리킨다. LocalAIService는 오프라인 초기화를 건너뛴다. 메인은 Chromium 원격 요청과 다운로드·프로세스 관련 IPC를, Electron 백엔드는 계정/이미지 API의 선행 호출을 막는다. Google Fonts 원격 import도 제거했다.

비패키징 프로덕션 번들의 preload 위치와 초기화 대기 순서를 실제 기동에 맞게 보완했다. [기동 보고서와 한계](validation/2026-11-20-p0-offline.md)를 참고한다.


### 오프라인 통제의 경계

통제 대상은 기본 세션의 Chromium HTTP/WebSocket 요청, 명시한 IPC 5종과 렌더러 계정/API 호출이다. 시스템 전체 방화벽이 아니다. loopback은 포트 제한 없이 개발 서버에 허용하므로 로컬 프록시의 외부 중계까지 막는다는 보장은 없다. Node의 fetch/http(s), 다른 session/partition 및 webview를 도입하면 이 정책을 별도로 적용해야 한다.

`src/main/localai.ts`에는 기존 Node fetch 2개가 있고 메인의 모델 로드·배경 제거 IPC에서 선행 차단한다. `main.ts`의 net 서버는 로컬 AI 시작 전 포트 탐사용이며 spawn IPC에서 차단한다. 검토 원문의 “메인에 Node 클라이언트 없음”을 그대로 채택하지 않았다. `test:offline`의 AST 목록 검사는 새 네트워크·세션 진입점에 검토를 요구하는 보조 검사이며 모든 우회를 증명하는 분석기는 아니다. 컨텍스트 메뉴의 Google 검색/시스템 조회도 오프라인에서는 끈다.


## P1-01 오프라인 작업실

`App.tsx`는 기존 서비스 수명을 유지하며 mock일 때 `PreviewWorkspace.tsx`를 표시한다. 메모리 초안/최근 예제 상태는 App에 두어 기존 V3 화면을 다녀와도 유지한다. 새 화면은 V3 Session을 수정하지 않고 이름·개수만 받는다.

`preview/workspaceDraft.ts`가 격자·숫자 입력을 P0-03a 계약으로 투영한다. `MockBackend.renderDraftPreview`는 직접 작성한 SVG 또는 합성 오류만 반환하며 파일/API를 호출하지 않는다. 새 UI의 실행·기록은 V3 대기열과 별개이며 실연결은 P1-02다. 스타일은 PreviewWorkspace 아래에 한정한다.

## P1-01b 예제 씬·대기열

`PreviewWorkspace`는 프롬프트/캐릭터(`WorkspacePrompts`), 결과/기록(`WorkspaceResults`), 설정(`WorkspaceSettings`), 씬/예약(`WorkspaceScenes`)을 조립한다. `App`이 초안·결과와 `WorkspaceQueue`의 수명을 갖는다. 기존 V3 화면으로 전환해도 예약은 유지되고 실행 중인 예제는 계속된다. 두 화면의 전역 알림·대화상자는 공통으로 표시한다.

`WorkspaceState.draft`가 현재 선택한 씬의 편집 원본이다. 다른 씬 선택 또는 예약 시 `snapshotWorkspaceScenes`가 현재 편집을 합쳐 깊은 복사한다. 선택하지 않은 씬의 초안은 `scenes`에 보관한다. UI는 현재 초안을 직접 `scenes`에 중복 쓰지 않는다. V3 Session/TaskQueueService/저장 파일과 연결하지 않는다.

예제 큐는 예약 시 모든 씬을 검증하고 씬 × 반복의 독립 스냅샷을 만든다. 기본 무작위 시드는 **각 작업 실행 시** 결정해 요청/결과에 남긴다. 같은 예약 안의 무작위 시드 충돌은 uint32 범위에서 다음 값으로 이동한다. 고정 0은 바꾸지 않는다. 실행은 직렬이며 중지는 현재 예제 완료 후 다음 작업을 시작하지 않는 동작이다. 실패는 그 작업을 실패로 표시하고 중지한다. 계속은 남은 대기 작업을 실행하며 실패 작업을 자동 재시도하지 않는다. 이 정책은 실 API 취소/과금 정책이 아니다.

한 예약은 최대 60개(화면의 3씬 × 반복 1~10), 결과는 최근 120개다. 오래된 결과는 열기 버튼이 비활성화된다. 캐릭터는 활성 수에 모델 입력 한도 6/22를 적용하고 비활성 포함 보관 슬롯은 32개다. 삭제 취소는 현재 씬에서 마지막 삭제 1건을 복원하며 다음 삭제·씬/화면 전환 시 바뀐다. 새 화면도 기존 whiteMode를 따른다. 모두 mock 전용·메모리 보관이다.


## P0-03b1 신규 인증·전송

`src/main/nai/`는 토큰 보관·새 인증 IPC·오류 코드와 전송기를 분리한다. main.ts는 ready/초기화 후 인증 IPC를 등록하고 preload는 토큰을 반환하지 않는 별도 facade를 제공한다. 생성 경로에는 전송기를 아직 연결하지 않는다. `offlineNetwork.ts`는 기존 defaultSession 차단을 재사용하며, 전송기는 같은 세션을 명시한다. 새 Node HTTP 클라이언트/partition을 추가하지 않았다. 전송 경로 추가를 정적 tripwire 목록에 기록했고 실제 Electron 차단도 검사한다. [상세 경계](NAI_AUTH_TRANSPORT.md).


## 포크 식별·인증 화면

`appIdentity.ts`와 `main/forkProfile.ts`가 bootstrap에서 기본 포크 경로를 선택한다. 기존 중첩/링크 검증을 재사용하고 원본 이름을 보호한다. `NaiAuthSettings.tsx`는 App의 공통 바깥 영역에 있으며 두 화면이 같은 버튼으로 연다. 입력 값은 uncontrolled password DOM 안에만 두고, renderer/auth/tokenInput.ts는 정리·검증/문구만 처리한다. check IPC는 메인 read 이후 상태만 반환한다. 새 모델 전송/저장 타입은 연결하지 않았다.


## 다음 시작 연결 모드 (D-028)

main/networkMode.ts가 부트스트랩 뒤 프로필의 비밀 없는 설정을 읽어 current를 고정한다. main.ts의 runtimeOptions와 preload의 runtime은 이 고정값을 사용한다. network-mode-* IPC는 승인된 메인 문서만 허용하며 오프라인에서도 다음 시작 설정을 저장할 수 있다. 토큰 IPC와 실제 네트워크 차단은 재시작 전까지 그대로다.

NetworkModeSettings 화면은 저장과 재시작을 분리한다. restartPreparation은 V3 saveAll을 기다리고 전후에 작업 유무를 확인한다. TaskQueueService의 activeRuns는 stop/clear 이후에도 아직 끝나지 않은 promise를 추적하는 용도이며 큐 순서/생성 정책을 변경하지 않는다. 실제 native relaunch는 중복 요청을 막고 제어된 close 경로를 사용한다. 임시 작업실 상태를 디스크에 저장하는 기능은 아직 없다.


## 제한된 메인 이미지 응답

main/nai/imageResponse.ts는 단일 엔트리 ZIP의 헤더/디렉터리/descriptor를 먼저 검증한 뒤 Node zlib 스트림의 실제 출력을 제한한다. CRC·PNG 구조 검사 후 바이트를 반환하며 파일 추출/저장이나 픽셀 재인코딩은 없다. transport.sendImage는 같은 전송 기한과 취소 신호를 전달한다. 이 경로는 하네스의 합성/루프백 응답으로 검증했으며 실제 앱의 모델/생성 IPC에는 아직 연결하지 않았다. 렌더러 readPreviewPNGZip은 기존 오프라인 fixture용으로 남는다.


## 연구 전용 1회 생성 도구 (D-032)

일반 main.ts/App/작업실과 별도로 nai-live-entry.cjs가 Electron ready 전에 명시적 외부 테스트 프로필을 선택한다. 저장된 연결 모드·원본 TOKEN.txt·세션은 읽지 않는다. production 프리로드 대신 좁은 validation facade와 기존 신뢰 프레임 검사를 사용한다. 기본 세션은 정확한 생성 HTTPS POST만 허용하고 offline/mock은 IPC와 전송 전에 거부한다. 목적지 치환은 합성 하네스 내부에만 있다.

LiveValidation은 고정 후보의 해시와 수동 웹 비용 근거를 묶고 wx 기록으로 1회를 선점한다. NaiTransport의 선택 diagnosticCapture가 수신 바이트를 먼저 비공개 파일에 남기고 기존 해석기가 검증한다. capture 미지정인 일반 경로는 오류 본문을 폐기한다. 연구 창은 내용 없는 내부 사유를 명시적으로 읽는 진단 도구이며 운영 renderer/preload의 내부 사유 접근은 정적 검사로 금지한다. 결과 PNG/원문 파일은 일반 프로젝트·씬·대기열 저장 형식이 아니다. [실행·한계](NAI_LIVE_VALIDATION.md).

## 운영 이미지 MIME 정책 (D-036)

`NaiTransport.sendImage`는 운영 기본값으로 2xx의 미분류/미지정 MIME을 ZIP 시작부로 선별 수신하고, 기존 제한된 ZIP·PNG 해석을 통과한 원본 PNG만 반환한다. 원문 `send`의 연구 opt-in과 구분한다. 새 Node 네트워크 경로·다른 partition·목적지 옵션을 추가하지 않는다.

메인 전용 `responseMediaType.ts`는 길이 제한/파라미터 제거/형식 검사를 하고 present/absent/invalid를 구분한다. 선택 observer에는 이 결과와 HTTP 상태만 전달하며 연구 결과 파일도 재검사한다. 기존 분류 other를 임의의 실제 MIME으로 치환하지 않는다. 제품 생성 IPC/모델 바인딩·프로젝트 저장·대기열 연결은 아직 후속이다.

## 신규 프로젝트 저장 기반 (D-037)

workspaceProject.ts는 V3와 독립된 허용 스키마/고정 오류·IPC 타입이다. WorkspaceDraft/Scene의 type import만 사용하며 renderer 서비스/계정 모듈을 메인에서 실행하지 않는다. main/projects/projectStore.ts는 고정 포크 프로필 아래 manifest·불변 history·내용 해시 PNG를 관리한다. PNG 검사는 main/nai/imageResponse.ts의 동일 구조 검사 함수를 재사용한다.

main.ts는 인증과 같은 trusted frame 검사로 projects IPC를 등록한다. offline은 이 로컬 동작을 차단하지 않는다. preload.projects는 list/create/open/save/history/recover만 제공하며 임의 경로·PNG 입력/반환은 없다. 메인 내부 addPNG/readPNG는 후속 실제 생성 연결용이다. 기존 작업실 상태·MockBackend·V3 서비스에는 아직 연결하지 않는다. [상세 저장/복구](PROJECT_STORAGE.md).

## 프로젝트 UI·worker·닫기 수명 (D-039)

App이 ProjectController를 소유하고 WorkspaceProjectControls의 조작부/공유 dialog를 분리한다. 이력·목록/오류·저장 바인딩은 서비스 스냅샷이며 프롬프트 편집 원본은 기존 WorkspaceState다. snapshotWorkspaceScenes로 현재 선택 씬의 편집을 합쳐 저장하며 저장 중 캡처한 fingerprint만 저장됨 기준으로 삼는다. 프로젝트를 열면 이전 예제 기록/대기열을 비우되 pending/running이 있으면 전환하지 않는다.

projectIpc는 awaited ProjectOperations를 받는다. 일반 main.ts는 ProjectService를 주입하며 worker_threads의 고정 projectWorker가 허용된 list/create/open/save/history/recover/copy만 실행한다. worker에 Electron 세션/인증을 넘기지 않는다. 기존 동기 ProjectStore는 코어 검사와 파일 원자성/잠금 정책을 유지한다. 실행 중 main 전송 타이머와 프로젝트 I/O를 같은 스레드에서 돌리지 않는다.

ProjectCloseCoordinator가 native close를 보류하고 승인된 메인 문서의 프로젝트 결정/V3 저장 완료 응답을 기다린다. 요청은 workspace-close-request, 응답은 trusted finish/cancel이다. 새 창 생성 때 승인 상태를 reset한다. App의 전체 입력 영역은 저장/닫기 준비 중 inert이고 dialog는 그 바깥에 있다. 앱 종료 준비 실패는 창을 유지하며 임의 timeout 종료나 자동 잠금 해제는 없다. 모바일의 기존 backend close 동작은 유지한다.
