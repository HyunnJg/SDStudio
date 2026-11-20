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
