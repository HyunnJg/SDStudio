<!-- 사용자 제공 검토 원문. 2026-11-20에 읽음. 줄바꿈만 LF로 통일. 제안의 처리 결과는 2026-11-20-review-resolution.md 참조. -->

# 초기 독립 검토 — P0 계획·외부 요청·모델·라이선스

- 작성일: 2026-11-20 (Asia/Seoul)
- 검토자 / 모델·버전: Claude (Anthropic), Opus 5.5
- 작업 ID / 검토 범위: [초기 검토 요청](2026-11-20-initial-request.md)의 질문 1–6. 정적 소스·문서 검토만
- 저장소 / 브랜치 / 실제 커밋 SHA: `HyunnJg/SDStudio` / `main` / `0b129822b477651f563b4ab1f2817c7665a2bbbf` (shallow clone이라 기준 원본 `f2088add`과의 조상 관계는 직접 확인하지 않음)
- 읽은 파일: `AGENTS.md`, `docs/*.md`, `docs/reviews/*`, `.gitignore`, `.gitmodules`, 루트·`release/app`·`src/native`의 `package.json`, `.github/workflows/*.yml`(node-version), `src/__tests__/App.test.tsx`, `src/main/main.ts`(일부), `src/renderer/models/{index,TaskQueueService,AppUpdateNoticeService,LoginService,PromptService,LocalAIService,types}.ts`(관련 부분), `src/renderer/backends/genVendors/nai.ts`, `src/renderer/componenets/App.tsx`(export·URL), 자산 목록(`assets/`, `src/native/`)
- 실행한 검증: `grep`/정적 읽기만. 의존성 설치·빌드·lint·앱 실행·실제 API 호출 **모두 미실행**. NovelAI 공식 자료는 이번 검토에서 **조회하지 않음**(질문 3의 V4 관련 내용은 검토자의 사전 지식이며 미검증으로 표시)

## 판단

**수정 후 진행.** 문서의 정적 조사 내용은 확인한 범위에서 정확하다. 다만 (1) 첫 `npm start` 전에 원본 SDStudio와 데이터 폴더가 겹칠 수 있는 문제, (2) 매 생성마다 영구 식별자를 원본 운영자 서버로 보내는 호출, (3) 잠금 파일이 ignore되어 P0-01의 "재현 가능한 최소 명령"이 성립하기 어려운 점을 P0 순서에 먼저 반영해야 한다. 또한 V4 계열 지원 여부는 단순 모델명 매핑이 아니라 **씬 저장 형식과 프롬프트 패널 구조**를 바꾸므로, P1-01 화면 설계 전에 결정하는 것이 재작업을 줄인다.

## 발견 사항

| 우선순위 | 파일·위치 | 관찰한 사실 | 예상 영향·추론 | 제안 | 검증 방법 |
| --- | --- | --- | --- | --- | --- |
| 높음 | `src/main/main.ts:105`, `release/app/package.json`, 루트 `package.json` `build.appId`/`productName` | 데이터 폴더가 `app.getPath('userData') + '/SDStudio'`. `productName: SDStudio`, `appId: io.sunho.SDStudio`가 원본 그대로 | (추론) 원본 SDStudio를 쓰는 PC에서 포크를 실행하면 같은 `config.json`·세션·`TOKEN.txt`를 읽고 쓸 가능성이 높다. 개발 모드의 실제 경로는 미확인 | P0-01에서 **앱 실행 전에** 개발용 데이터 경로 분리(예: 환경변수로 `app.setPath('userData', …)` 덮어쓰기)를 먼저 넣고, 첫 실행은 빈 프로필로 한다. 앱 식별자 변경은 P3와 별도로 결정 | 첫 실행 시 로그로 `DEFAULT_APP_DIR` 출력, 원본 데이터 폴더의 수정 시각이 바뀌지 않는지 확인 |
| 높음 | `TaskQueueService.ts:94-104, 312-329` | 생성 1건마다 `https://ip.sunho.kim`에 `Authorization: 'yuzu'`, `uuid: config.uuid` 헤더로 요청. `uuid`는 최초 생성 후 config에 영구 저장. 결과(IP 변경 시 `throw new Error('IP')`)는 `isMobile`일 때만 사용 | 문서의 위치 설명은 정확하다. 추가로: 데스크톱에선 결과를 쓰지 않는데도 **영구 기기 식별자**가 제3자에게 매번 전송되고, 생성마다 네트워크 왕복이 하나 더 붙는다(응답 지연·실패 시에도 `generateImage` 전에 대기) | P0-02 첫 변경으로 데스크톱에서 호출 제거. 모바일 IP 검사 존치 여부는 별도 결정(D-xxx)으로 남김 | fetch를 가로채는 테스트로 생성 1회당 외부 호스트가 `image.novelai.net`(가짜) 하나뿐인지 확인 |
| 높음 | `.gitignore`(`package-lock.json`), 루트 `package.json` | 포크의 `.gitignore`가 원본처럼 `package-lock.json`을 무시. 의존성은 대부분 `^` 범위, `electron: ^26.2.1`. CI는 Node `22.4.1`, 조사 환경은 Node `24.22.3` | 잠금 파일이 없으면 P0-01 성공 결과를 다음 작업자가 재현할 수 없다. Electron 26은 지원 종료된 지 오래라 `node-gyp`(src/native)·`electron-builder install-app-deps` 단계에서 Node 24와 충돌할 여지가 있다(추론) | P0-01은 Node 22.4.1로 먼저 재현하고, 성공 시 `.gitignore`에서 lock 제외 규칙을 지우고 루트·`release/app` lock을 커밋. Electron 업그레이드는 별도 작업 ID로 분리 | 깨끗한 클론에서 `npm ci` 성공 여부 |
| 높음 | `nai.ts:31-38, 122-170`, `models/types.ts`(Scene/Session) | 요청 본문이 V3 형태로 고정: `input` 단일 문자열, `params_version: 1`, `sm`/`sm_dyn`, `reference_image_multiple`에 원본 이미지 전달, `legacy_v3_extend`. 모델명은 V3 3종(+furry-3)만 | V4 계열을 지원하면 모델명 교체로 끝나지 않고 **캐릭터별 프롬프트·위치** 같은 새 입력이 생긴다(아래 "불확실한 부분"의 미검증 항목). 이는 `ImageGenInput`과 씬 JSON 형식 변경이며, NovelAI식 UI의 좌측 패널 구조도 좌우한다 | P0-03을 P1-01의 선행 조건으로 추가. "V3 유지 / V4.x만 / 둘 다" 중 결정 후 화면 설계 | 공식 자료(또는 확인 날짜 명시한 근거)로 파라미터 표 작성, 가짜 응답으로 요청 본문 스냅샷 테스트 |
| 중간 | `AppUpdateNoticeService.ts:14`, `models/index.ts:82-83` | 생성자에서 `this.run()`, `index.ts`에서 다시 `appUpdateNoticeService.run()` | 문서의 "중복 루프 가능성"은 **사실로 확인됨**: 무한 루프 2개가 240초마다 각각 GitHub API를 호출하고 `updated` 이벤트도 중복 발생. 또 태그가 `v3.1.12` 형식이면 `Number('v3')`=NaN이라 비교가 항상 false가 될 수 있다(태그 형식 미확인) | P0-02에서 호출 하나 제거 + 포크용으로는 업데이트 확인 기본 비활성화. 원본 저장소 참조는 `App.tsx:155` 외에 루트 `package.json`의 `build.publish`(owner: sunho)에도 있으니 P3 목록에 추가 | 가짜 fetch로 시작 후 호출 횟수 1회 확인 |
| 중간 | `models/index.ts:30-31`, `nai.ts:15`, 서비스 생성자들 | 백엔드는 모듈 로드 시점에 `window.electron`으로 선택. `nai.ts`가 `models`의 `backend`를 import(순환 참조). `LoginService` 생성자가 `TOKEN.txt` 읽기, `sessionService.run()`, 업데이트 루프, `localAIService.statsModels()`가 import만으로 시작 | 질문 4의 "브라우저 → Android 백엔드" 설명은 정확하다. 따라서 가짜 백엔드는 컴포넌트 단에서 끼울 수 없고, `index.ts`의 선택 지점 하나를 바꾸는 것이 최소 경계다 | `index.ts`에 `window.electron` 검사 이전 단계로 가짜 백엔드 선택 분기(예: 빌드 환경변수) 추가. 서비스 시작 호출을 `init()` 하나로 모으는 것은 그다음 작업 | 브라우저로 열었을 때 Android 백엔드가 생성되지 않고 외부 요청이 0건인지 확인 |
| 중간 | `PromptService.ts:41-130, 439`, `types.ts:546` | `<모음.조각>` 문법이 이미 있고, `multi` 조각은 줄 하나를 무작위로 고르는 `PromptRandomNode`로 전개. 선택은 `Math.random()` | **와일드카드·랜덤 프롬프트는 이미 구현돼 있다.** P2-01은 신규 기능이 아니라 개선 항목: 무작위 선택이 시드와 무관해 같은 시드로 재현되지 않는다 | P2-01을 "기존 multi 조각의 시드 기반 재현성·사용한 최종 프롬프트 기록"으로 다시 정의. 새 문법 도입 전에 기존 문법 호환을 기준으로 | 같은 시드·같은 씬으로 두 번 전개했을 때 결과 비교 단위 테스트 |
| 중간 | `src/native/db.csv`, `assets/db.txt`, `release/app/data/db.csv` | 약 12.4만 행의 태그·게시물 수·별칭 데이터(`1girl,0,4919233,…`) | 라이선스 조사에 이 데이터의 출처·조건이 없다. 형태로 보아 Danbooru 태그 통계에서 파생된 것으로 보이나 **추정이며 미확인** | LICENSE_REVIEW에 별도 행 추가: 출처 미확인, 배포 포함 여부 결정 전 허용으로 가정하지 않음 | 원본 커밋 이력에서 파일 추가 커밋·메시지 확인 |
| 중간 | `assets/fonts/NotoSans-*.ttf` | 폰트 3종 포함. 저장소에서 폰트용 라이선스 파일을 찾지 못함 | Noto 폰트는 보통 SIL OFL 1.1로 배포되며, 재배포 시 라이선스 문구 동봉을 요구한다. 이 파일들의 실제 라이선스는 **미확인** | LICENSE_REVIEW에 폰트 행 추가. 공개 배포(P3) 전에 원 출처와 OFL 문구 동봉 확인 | 폰트 파일 메타데이터의 license 필드 확인(`fc-query` 등) |
| 중간 | `.erb/`, 루트 `package.json:322` | electron-react-boilerplate 기반(스크립트 주석·opencollective URL 잔존). 해당 보일러플레이트의 MIT 고지 파일은 없음 | 원본 SDStudio의 MIT 표기와 별개로 상위 보일러플레이트의 저작권 고지가 필요할 수 있다(미확인) | LICENSE_REVIEW에 "기반 보일러플레이트" 행 추가, 사용한 버전 특정 | 보일러플레이트 저장소의 대응 버전·LICENSE 확인 |
| 중간 | `LocalAIService.ts:7-10` | 로컬 AI 바이너리를 `huggingface.co/mathneko/localai`에서, 모델을 `sunho/BiRefNet` 릴리스에서 다운로드 | 문서는 BiRefNet **코드** 라이선스만 확인. 실행 시 받는 바이너리·가중치의 조건과 출처는 기록되지 않음. 또 P0-02의 외부 요청 목록에 이 두 URL이 빠져 있음 | ARCHITECTURE의 외부 요청 목록과 LICENSE_REVIEW에 추가. 초기 UI 작업에서는 로컬 AI 기능을 끈 상태로 검증 | `grep -rn https?://` 결과를 문서 표로 고정 |
| 낮음 | `src/__tests__/App.test.tsx`, `App.tsx:128` | default import vs named export `export const App` | 문서 설명이 정확하다. 이 테스트는 실행해도 실패할 것으로 보인다(미실행) | 기존 테스트 수정은 P0-02 가짜 백엔드 이후로 | — |
| 낮음 | `nai.ts:62-95`, `electronBackend.ts:75` | 이메일·비밀번호를 받아 앱 안에서 argon2로 접근 키를 만들어 로그인하고, 받은 토큰을 `TOKEN.txt` 평문으로 저장 | 비밀번호가 앱 코드를 거친다. NovelAI 계정 설정의 영구 API 토큰을 직접 입력하는 방식이 있다고 알고 있으나 **미검증** | 로그인 방식 변경은 별도 작업. 이번 단계에선 문서에 현재 방식만 기록 | — |

## 잘 유지해야 할 부분

- **질문 분리와 미실행 표기.** STATUS·DEVELOPMENT가 "정적 확인"과 "실행 검증"을 일관되게 구분하고 있어, 이번 검토에서 문서의 사실 주장(IP 호출 위치, 업데이트 이중 `run()`, Android 백엔드 선택, 테스트 export 불일치, V3 매핑, CI Node 버전)을 모두 소스로 대조할 수 있었고 틀린 것은 없었다.
- **UI / 모델·API / 저장 형식 분리 원칙**(AGENTS.md). 위 V4 항목 때문에 이 원칙이 특히 중요하다.
- `legacy.ts`가 이미 구형 데이터 변환 경로로 존재한다. 저장 형식을 바꿀 때 같은 위치에 마이그레이션을 두면 원칙("이전 데이터 읽기 경로")과 맞는다.
- `NAI-Auto-Generator` 코드를 가져오지 않고, 라이선스가 확인되지 않은 것을 허용으로 쓰지 않는 태도.
- `.gitignore`에 `TOKEN.txt`, `.env*` 추가.

## 불확실한 부분

- **V4 계열 API 차이(질문 3) — 전부 미검증.** 검토자의 사전 지식으로는 V4/V4.5에서 `v4_prompt`/`v4_negative_prompt` 구조(기본 캡션 + 캐릭터별 캡션·좌표), 다른 `params_version`, SMEA(`sm`/`sm_dyn`) 미지원, 바이브 트랜스퍼의 사전 인코딩 방식, 별도 인페인팅 모델명, 다른 샘플러·`ucPreset` 의미 차이가 있는 것으로 알고 있다. 이번에 공식 자료를 조회하지 않았으므로 **P0-03에서 확인 날짜와 근거를 붙여 다시 확인해야 하며, 이 목록을 사실로 인용하면 안 된다.** 응답 형식(ZIP 유지 여부, 스트리밍 엔드포인트)도 미확인.
- 개발 모드(`npm start`)에서 `userData`가 원본 설치본과 실제로 같은 경로인지는 실행하지 않아 확인하지 못했다.
- 브라우저에서 Android 백엔드가 Capacitor 웹 구현으로 일부 동작할지, 바로 실패할지는 미확인.
- 원본 릴리스 태그 형식(`v` 접두사 여부)과 그에 따른 업데이트 비교 동작은 미확인.
- 서브모듈은 초기화하지 않았다. 문서의 BiRefNet·background-mode 라이선스 기술은 재확인하지 않았다.
- 원본 커밋 이력(`f2088add`까지)은 shallow clone이라 읽지 않았다. 태그 DB의 출처 추적에 필요하다.

## 다음 작업 제안

질문 1에 대한 답: 큰 순서(재현 → 외부 요청 정리 → 화면)는 적절하다. 끼어 있는 불필요한 큰 작업은 없고, 오히려 P3(CI·배포)는 지금 손대지 않는 게 맞다. 순서만 아래처럼 조정을 권한다.

1. **P0-01a 데이터 경로 격리** (앱 실행 전). 완료 기준: 개발 실행 시 원본 SDStudio 데이터 폴더를 건드리지 않음이 로그로 확인됨.
2. **P0-01 설치·빌드** — Node 22.4.1 기준. 완료 기준: 깨끗한 클론에서 `npm ci` 가능한 lock 파일 커밋, 실패 단계 기록.
3. **P0-02 외부 요청 차단** — 데스크톱 IP 호출 제거, 업데이트 이중 실행 제거·기본 비활성화, 로컬 AI 다운로드 URL 목록화, `index.ts` 가짜 백엔드 분기. 완료 기준: 가짜 백엔드로 실행 시 외부 요청 0건.
4. **P0-03 모델 결정** — V3/V4.x 지원 범위 결정과 근거 기록. 결정을 `DECISIONS.md`에 남김. 완료 기준: 요청 본문 스냅샷 테스트(가짜 응답).
5. **P0-04 라이선스 보강** — 태그 DB, Noto 폰트, 보일러플레이트, 로컬 AI 바이너리·가중치 행 추가(전부 "미확인"으로 시작). P0-02와 병렬 가능.
6. **P1-01 화면 설계** — P0-03 결정 반영. 질문 2의 최소 경계: `models/*`, `types.ts` 직렬화, `SessionService`, `legacy.ts`는 건드리지 않고, `App.tsx`의 조립과 새 레이아웃 컴포넌트가 기존 `PreSetEdtior`·`SceneQueueControl`·`TaskQueueControl`·`ResultViewer`를 감싸는 수준. V4 캐릭터 프롬프트 등 저장 필드 추가는 마이그레이션을 포함한 별도 PR.
7. **P2-01 재정의** — 질문 6: 새 와일드카드보다 기존 `multi` 조각의 시드 재현성이 먼저다. 실제 사용성 문제로는 (a) 생성마다 붙는 IP 확인 왕복, (b) 최신 모델 미지원 여부가 와일드카드·폴더 순회보다 체감 영향이 클 것으로 본다(추론).

## 처리 결과 — 구현 담당자가 작성

(미작성)
