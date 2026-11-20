<!-- 사용자 제공 검토 원문. 2026-11-20에 읽음. 줄바꿈만 LF로 통일. 제안의 처리 결과는 2026-11-20-review-resolution.md 참조. -->

[2026-11-20-initial-request.md](https://github.com/HyunnJg/SDStudio/blob/main/docs/reviews/2026-11-20-initial-request.md)와 [docs 디렉터리](https://github.com/HyunnJg/SDStudio/tree/main/docs), 그리고 핵심 소스 코드를 직접 확인해 [TEMPLATE.md](https://github.com/HyunnJg/SDStudio/blob/main/docs/reviews/TEMPLATE.md) 형식으로 정리했습니다. 바로 `docs/reviews/2026-11-20-gemini-initial-review.md` 등으로 옮겨 쓰실 수 있습니다.

# SDStudio 포크 초기 독립 검토 의견

* **작성일:** 2026-11-20
* **검토자:** Gemini
* **작업 ID / 검토 범위:** `2026-11-20-initial-request.md` (초기 독립 검토 질문 1~6번)
* **저장소 / 브랜치 / 실제 커밋 SHA:** [HyunnJg/SDStudio](https://github.com/HyunnJg/SDStudio) / `main` / [`0b129822b477651f563b4ab1f2817c7665a2bbbf`](https://github.com/HyunnJg/SDStudio/commit/0b129822b477651f563b4ab1f2817c7665a2bbbf) (기준 원본 `sunho/SDStudio@f2088add103ad683a31e0590448e6e5bb4d71556`)
* **읽은 파일:** [AGENTS.md](https://github.com/HyunnJg/SDStudio/blob/main/AGENTS.md?plain=1), [docs/STATUS.md](https://github.com/HyunnJg/SDStudio/blob/main/docs/STATUS.md), [docs/DECISIONS.md](https://github.com/HyunnJg/SDStudio/blob/main/docs/DECISIONS.md), [docs/ROADMAP.md](https://github.com/HyunnJg/SDStudio/blob/main/docs/ROADMAP.md), [docs/ARCHITECTURE.md](https://github.com/HyunnJg/SDStudio/blob/main/docs/ARCHITECTURE.md), [docs/DEVELOPMENT.md](https://github.com/HyunnJg/SDStudio/blob/main/docs/DEVELOPMENT.md), [docs/LICENSE_REVIEW.md](https://github.com/HyunnJg/SDStudio/blob/main/docs/LICENSE_REVIEW.md), [docs/reviews/TEMPLATE.md](https://github.com/HyunnJg/SDStudio/blob/main/docs/reviews/TEMPLATE.md), [docs/reviews/2026-11-20-initial-request.md](https://github.com/HyunnJg/SDStudio/blob/main/docs/reviews/2026-11-20-initial-request.md), [package.json](https://github.com/HyunnJg/SDStudio/blob/main/package.json), [.gitmodules](https://github.com/HyunnJg/SDStudio/blob/main/.gitmodules), [src/renderer/componenets/App.tsx](https://github.com/HyunnJg/SDStudio/blob/main/src/renderer/componenets/App.tsx), [src/renderer/models/index.ts](https://github.com/HyunnJg/SDStudio/blob/main/src/renderer/models/index.ts), [src/renderer/models/TaskQueueService.ts](https://github.com/HyunnJg/SDStudio/blob/main/src/renderer/models/TaskQueueService.ts), [src/renderer/models/AppUpdateNoticeService.ts](https://github.com/HyunnJg/SDStudio/blob/main/src/renderer/models/AppUpdateNoticeService.ts), [src/renderer/backends/genVendors/nai.ts](https://github.com/HyunnJg/SDStudio/blob/main/src/renderer/backends/genVendors/nai.ts), [src/renderer/backends/imageGen.ts](https://github.com/HyunnJg/SDStudio/blob/main/src/renderer/backends/imageGen.ts)
* **실행한 검증 / 미실행 항목:** 저장소 문서·소스 코드 정적 검토 완료 / 의존성 설치, 빌드, 린트, 앱 실행, 실제 NovelAI API 호출 및 서브모듈 내부 파일 열람 미실행

## 판단

**수정 후 진행** — 협업 문서와 경계 설정은 매우 탄탄합니다. 다만 P0 빌드 재현 범위를 데스크톱(Electron) 중심으로 좁히고, `models/index.ts`의 전역 부트스트랩과 원본 외부 호출(`ip.sunho.kim`, 원본 릴리스 조회)을 먼저 격리한 뒤 UI 개편에 들어가는 편이 훨씬 안전합니다.

## 검토 질문별 요약 답변

1. **작업 순서(빌드 재현 → 외부 요청·가짜 백엔드 정리 → 화면 개편):** 큰 순서는 적절하지만, **P0-01에 불필요하게 큰 범위가 끼어들 위험**이 있습니다. [DEVELOPMENT.md](https://github.com/HyunnJg/SDStudio/blob/main/docs/DEVELOPMENT.md) 기준 CI는 Node `22.4.1`인데 로컬은 `24.22.3`이고, `preinstall`에서 `node-gyp`로 `src/native`를 빌드하며 [.gitmodules](https://github.com/HyunnJg/SDStudio/blob/main/.gitmodules)에 `BiRefNet`·`capacitor-background-mode`가 걸려 있습니다. 데스크톱 NovelAI 자동화가 1차 목표라면 P0-01은 **Electron 데스크톱 빌드/기동 재현**으로 한정하고, `src/localai`(Python/BiRefNet)와 `android`/`ios`는 P0 필수 조건에서 빼는 것이 좋습니다.
2. **UI 교체 최소 변경 경계:** 1차 경계는 `src/renderer/models/`(서비스·저장소)와 `src/renderer/componenets/`(화면) 사이입니다. 단, [App.tsx](https://github.com/HyunnJg/SDStudio/blob/main/src/renderer/componenets/App.tsx) 128~238줄에 `taskQueueService.stop()`, 다크모드, 업데이트 알림, 다운로드/ZIP/이미지 캐시 리스너, `window.curSession` 동기화 같은 전역 수명주기가 섞여 있습니다. 이 부트스트랩 껍데기는 유지하고 **240~256줄의 탭·작업영역(`<QueueControl>`, `<PieceEditor>`)부터 단계적으로 교체**하는 것이 최소 변경 경계입니다.
3. **V3 매핑과 현재 목표 간 API·데이터 차이:** 현재 [imageGen.ts](https://github.com/HyunnJg/SDStudio/blob/main/src/renderer/backends/imageGen.ts) 1~5줄은 `Model` enum(`Anime`, `Inpaint`, `I2I`)에 작업 종류와 모델이 묶여 있고, [nai.ts](https://github.com/HyunnJg/SDStudio/blob/main/src/renderer/backends/genVendors/nai.ts) 31~50·98~199줄은 `nai-diffusion-3` / `nai-diffusion-3-inpainting` / `nai-diffusion-furry-3`만 매핑합니다. 반면 NovelAI V4/V4.5/V5에서는 멀티 캐릭터 프롬프트를 포함한 `v4_prompt` / `v4_negative_prompt`(`base_caption`, `char_captions`, `use_coords`, `use_order`) 구조가 필요하며 V5(`nai-diffusion-5-full`) 실측에서는 누락 시 500 오류가 보고되었고([Swas 실측 글](https://swiftlyaside.tistory.com/10), [ComfyUI CharacterPromptOptionNAID](https://comfy.icu/node/CharacterPromptOptionNAID)), V3 호출 시에는 V4 전용 필드를 제외해야 합니다([NAI-Auto-Generator v4.5 업데이트](https://arca.live/b/aiart/167645899)). 또한 `api.novelai.net` 대신 `image.novelai.net` 단일 호스트 사용과 Persistent API Token(`pst-...`) 인증 전환 여부를 먼저 확인해야 합니다([Swas 실측 글](https://swiftlyaside.tistory.com/10), [NekoAI-JS](https://github.com/Nya-Foundation/NekoAI-JS)). [ROADMAP.md](https://github.com/HyunnJg/SDStudio/blob/main/docs/ROADMAP.md) P1 초안에 이미 "캐릭터" 패널이 들어가므로, UI 설계 전에 **모델 버전 필드와 캐릭터 프롬프트 저장 스키마 확장 방안**을 맞춰 두어야 합니다.
4. **정적 조사 정확성:** [ARCHITECTURE.md](https://github.com/HyunnJg/SDStudio/blob/main/docs/ARCHITECTURE.md)의 세 항목 모두 **실제 코드와 일치하며, 아래 추가 사실이 확인**되었습니다.
* **IP 확인 호출:** [TaskQueueService.ts](https://github.com/HyunnJg/SDStudio/blob/main/src/renderer/models/TaskQueueService.ts) 94~113줄에서 `https://ip.sunho.kim`에 `uuid` 헤더뿐 아니라 하드코딩된 `Authorization: 'yuzu'` 헤더도 함께 전송합니다.
* **업데이트 루프 중복:** [AppUpdateNoticeService.ts](https://github.com/HyunnJg/SDStudio/blob/main/src/renderer/models/AppUpdateNoticeService.ts) 6~14줄 생성자와 [models/index.ts](https://github.com/HyunnJg/SDStudio/blob/main/src/renderer/models/index.ts) 80~84줄 양쪽에서 `run()`을 호출해 4분 주기 루프가 실제로 2개 동시에 돕니다. 추가로 [App.tsx](https://github.com/HyunnJg/SDStudio/blob/main/src/renderer/componenets/App.tsx) 147~161줄에도 `https://github.com/sunho/SDStudio/releases` 링크가 하드코딩되어 있습니다.
* **브라우저 Android 백엔드 선택:** [models/index.ts](https://github.com/HyunnJg/SDStudio/blob/main/src/renderer/models/index.ts) 30~33줄에서 `window.electron != null ? new ElectornBackend() : new AndroidBackend()` 및 `isMobile = window.electron == null`로 분기합니다.


5. **라이선스 조사 보완점:** [LICENSE_REVIEW.md](https://github.com/HyunnJg/SDStudio/blob/main/docs/LICENSE_REVIEW.md)의 기존 판단은 보수적이고 적절합니다. 다만 ① 루트·`assets/`·`images/`·`examples/`·`src/localai/`의 이미지·아이콘 자산 출처, ② `package.json`·`release/app/package.json`·`src/localai/requirements.txt`의 서드파티 의존성 라이선스, ③ 두 서브모듈 내부의 원저작자 고지 파일은 아직 미확인 상태이므로 허용된 것으로 가정하지 말고 별도 표로 추적해야 합니다.
6. **와일드카드·폴더 순회보다 먼저 풀 사용성 문제:** 자동화 도구 실사용에서는 ① **Persistent API Token 인증 및 401/공백 오류 안내**, ② **대량 생성 중 실패(429/500/네트워크 오류) 복구·일시정지·실패 건만 재시도·예상 Anlas/무료 구간 가드**, ③ **PNG 메타데이터(Stealth PNG 포함) 보존 및 드래그 앤 드롭 설정 복원**이 와일드카드·폴더 순회보다 체감 영향이 훨씬 큽니다.

## 발견 사항

| 우선순위 | 파일·위치 | 관찰한 사실 | 예상 영향·추론 | 제안 | 검증 방법 |
| --- | --- | --- | --- | --- | --- |
| 높음 | [TaskQueueService.ts](https://github.com/HyunnJg/SDStudio/blob/main/src/renderer/models/TaskQueueService.ts) 94~113, 255~330줄 | `fetchIPAddress`가 `https://ip.sunho.kim`에 `uuid`와 `Authorization: 'yuzu'` 헤더를 전송함 | 포크 실행 시 원본 제작자 개인 서버로 트래픽·식별자가 유출되고 외부 장애 시 생성 큐에 영향을 줄 수 있음 | P0-02에서 해당 호출을 제거하거나 기본 비활성 옵트인으로 격리 | 코드 검색으로 `ip.sunho.kim` 잔여 참조 0건 확인 및 오프라인 큐 드라이런 |
| 높음 | [AppUpdateNoticeService.ts](https://github.com/HyunnJg/SDStudio/blob/main/src/renderer/models/AppUpdateNoticeService.ts) 6~14, 36~50줄 / [models/index.ts](https://github.com/HyunnJg/SDStudio/blob/main/src/renderer/models/index.ts) 80~84줄 / [App.tsx](https://github.com/HyunnJg/SDStudio/blob/main/src/renderer/componenets/App.tsx) 147~161줄 | `run()`이 생성자와 `models/index.ts`에서 이중 호출되고, 원본 `sunho/SDStudio` 릴리스 API 및 URL을 참조함 | 4분 주기 폴링이 중복 실행되고 포크 사용자에게 원본 릴리스 업데이트 팝업이 노출됨 | 생성자 내 `this.run()` 제거, 포크 전까지 업데이트 확인 기본 비활성화, 릴리스 URL 설정값 분리 | 앱 기동 시 네트워크 요청 0건 및 `AppUpdateNoticeService` 단위 테스트 |
| 높음 | [models/index.ts](https://github.com/HyunnJg/SDStudio/blob/main/src/renderer/models/index.ts) 30~33, 49~84줄 | 모듈 로드 시점에 `window.electron` 유무로 `AndroidBackend`·`isMobile`을 확정하고 여러 서비스의 `run()`을 즉시 실행함 | 일반 브라우저로 가짜 데이터 UI를 띄우면 모바일(`TouchBackend`) 경로가 타며 모킹 주입이 어려움 | 백엔드 팩토리(Mock/Electron/Android)와 명시적 `bootstrap()` 분리 | 브라우저 환경에서 Mock 백엔드로 데스크톱 UI 기동 확인 |
| 높음 | [imageGen.ts](https://github.com/HyunnJg/SDStudio/blob/main/src/renderer/backends/imageGen.ts) 1~5줄 / [nai.ts](https://github.com/HyunnJg/SDStudio/blob/main/src/renderer/backends/genVendors/nai.ts) 21~50, 98~217줄 | `Model` enum이 작업 유형과 결합되어 있고 `nai-diffusion-3` 계열과 `api.novelai.net` 로그인/잔액 경로를 사용함 | V4/V4.5/V5 모델 및 캐릭터 프롬프트 도입 시 기존 씬/프리셋 스키마와 요청 본문이 충돌할 수 있음 | `action`(generate/i2i/inpaint)과 `modelId`를 분리하고 V3/V4+ 페이로드 어댑터 계층 도입 | V3/V4+ 페이로드 직렬화 스냅샷 테스트 (실제 API 호출 없이 검증) |
| 중간 | [package.json](https://github.com/HyunnJg/SDStudio/blob/main/package.json) / [DEVELOPMENT.md](https://github.com/HyunnJg/SDStudio/blob/main/docs/DEVELOPMENT.md) / [.gitmodules](https://github.com/HyunnJg/SDStudio/blob/main/.gitmodules) | Node 버전 불일치(CI `22.4.1` vs 로컬 `24.22.3`), 루트 `package-lock.json` 미추적, `preinstall` 네이티브 빌드 및 서브모듈 2개 존재 | P0-01 빌드 재현이 네이티브/모바일/Python 환경 문제로 지연될 수 있음 | P0-01 성공 기준을 "Node 22 LTS 기준 Electron 데스크톱 빌드/기동"으로 명확히 축소 | 클린 브랜치에서 데스크톱 빌드·기동 로그를 `DEVELOPMENT.md`에 기록 |
| 중간 | [LICENSE_REVIEW.md](https://github.com/HyunnJg/SDStudio/blob/main/docs/LICENSE_REVIEW.md) 및 저장소 자산/의존성 | 이미지·아이콘 자산, npm/Python 의존성, 서브모듈 내부 고지 파일의 개별 라이선스 상태가 미기록 상태임 | 추후 배포(P3) 시 고지 누락 또는 비호환 라이선스(예: AGPL 계열 외부 코드) 혼입 위험 | 자산·의존성별 확인 상태 표 추가 및 배포 전 `license-checker` 등 자동 수집 절차 도입 | 배포 체크리스트에서 미확인 항목 0건 확인 |

## 잘 유지해야 할 부분

* **원본 이력·크레딧 및 오타 경로 보존 원칙:** [AGENTS.md](https://github.com/HyunnJg/SDStudio/blob/main/AGENTS.md?plain=1) 12·33줄처럼 `componenets` 같은 오탈자 경로를 초기에 일괄 리네임하지 않기로 한 결정은 diff 오염과 회귀 위험을 크게 줄여줍니다.
* **보수적인 라이선스 검증 태도:** 독립 라이선스 파일이 없는 `NAI-Auto-Generator` 코드를 반입하지 않고, `src/native`의 `ISC` 표기를 상위 `MIT`로 덮어쓰지 않은 기준은 그대로 유지해야 합니다.
* **변경 축 분리 원칙:** UI 개편(P1), 모델/API 전환(P0-03 이후 별도 작업), 반복 자동화 기능(P2)을 섞지 않기로 한 [DECISIONS.md](https://github.com/HyunnJg/SDStudio/blob/main/docs/DECISIONS.md) D-005 방향이 매우 합리적입니다.

## 불확실한 부분

* **실제 빌드·실행 결과:** `npm install`, `src/native` `node-gyp` 빌드, `npm run build`, `npm start`는 이번 검토에서 실행하지 않아 Node 22/24 호환성 및 `release/app` 연동 이슈는 미확인입니다.
* **기존 씬·프리셋 저장 스키마 상세:** `SessionService.ts`, `PromptService.ts`, `QueueControl` 내부 코드는 열람하지 않아, 기존 JSON 저장 구조가 알 수 없는 신규 필드(예: 캐릭터 프롬프트)를 읽고 쓸 때 보존하는지는 미확인입니다.
* **최신 NovelAI API 공식 규격 세부 사항:** 실제 API 호출을 수행하지 않았으므로, 지원할 정확한 모델 ID 목록(V4/V4.5/V5 및 inpaint/furry 변형), Vibe Transfer / Director Reference 파라미터 스키마, 기존 `GET /user/data` 잔액 조회의 현행 동작 여부는 P0-03에서 소규모 실측으로 확인이 필요합니다.
* **서브모듈 및 자산 파일 내부 고지:** `BiRefNet`, `capacitor-background-mode` 내부 파일과 루트·`assets/`·`src/localai/` 이미지 파일의 원출처는 미확인입니다.

## 다음 작업 제안

1. **`P0-01` 범위 축소 및 재현:** `work/p0-desktop-build` 브랜치에서 Node 22 LTS 기준으로 Electron 데스크톱 빌드·기동만 먼저 재현하고, 깨진 `App.test.tsx`와 루트 `test` 스크립트를 최소 단위로 복구합니다.
2. **`P0-02` 외부 의존성 차단 + Mock 백엔드 주입:** `ip.sunho.kim` 호출 제거, `AppUpdateNoticeService` 중복 루프 및 원본 릴리스 참조 차단, `models/index.ts`에 Mock 백엔드 모드를 추가합니다.
3. **`P0-03` 모델/인증 경계 확정 (별도 설계 작업):** Persistent API Token(`pst-...`) 지원 여부와 V3/V4+ 공용 요청·저장 스키마(특히 `SessionService` 마이그레이션 및 캐릭터 프롬프트 필드)를 확정한 뒤 `P1-01` UI 개편으로 넘어갑니다.