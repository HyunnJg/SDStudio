# NovelAI 지원 범위와 요청 설계 — P0-03a

확인일: 2026-11-20 (Asia/Seoul). 기준 커밋: `3759b7a5b9c7e059e0df4194e91f969974c44c33` (PR #3 보완·병합). **공식 문서 조사와 오프라인 투영 검증이며 실제 API 호환 인증이 아니다.**

## 결정한 범위

첫 새 화면은 텍스트 → 이미지의 기본/부정 프롬프트, 캐릭터별 프롬프트·부정 프롬프트, 순서·활성 여부·위치, 해상도·시드·스텝·가이던스·샘플러를 다룬다. 기존 V3 세션의 모델을 자동으로 바꾸지 않는다. 최신 모델 작업은 독립된 메모리 초안으로 검토하고 기존 저장 객체·실제 요청 경로에는 연결하지 않는다.

첫 실제 연동 목표는 V4.5 Full로 둔다. 기존 Vibe·인페인팅 흐름과 최신 캐릭터 입력을 단계적으로 검증하기 위한 프로젝트 선택이며, 최신 모델이라는 뜻은 아니다. V5 Full/Curated는 현재 공식 모델 목록에 있으므로 입력 초안의 family를 분리해 22캐릭터 범위를 검토할 수 있게 한다. 모델별 기능을 V4.5와 같다고 가정하지 않는다. V4.5 Curated는 Full 연동 후 평가한다.

공식 스키마에 모델 ID enum과 모델별 필수값·기본값이 없다. 따라서 `nai-diffusion-4-5-full`처럼 알려진 문자열을 이번에 공식 확인한 ID로 등록하지 않았다. 프로토타입의 API 모델 인자는 테스트에서 `fixture-model-not-for-api`다. 실제 전송 전의 바인딩·호환 검증은 **P0-03b**로 남긴다. P1-01은 이 범위의 오프라인 화면을 만들고, P1-02의 실제 연결은 P0-03b 이후에 한다.

## 근거 목록

| 자료 | 확인한 내용 | 확인하지 못한 내용 |
| --- | --- | --- |
| [공식 모델 문서](https://docs.novelai.net/en/image/models/) | 현재 V5 Full/Curated, 이전 V4.5 및 V4 모델 설명 | 각 제품명의 정확한 API ID 및 사용자별 제공 상태 |
| [공식 Image API Swagger](https://image.novelai.net/docs/index.html), [JSON 스키마](https://image.novelai.net/docs/doc.json) | 엔드포인트, 인증 안내, 필드 타입·중첩 구조, ZIP/JSON 응답 | 모델별 조합 유효성·기본값·모든 수치 범위. schema의 version 1.0은 모델 버전이 아님 |
| [공식 다중 캐릭터 문서](https://docs.novelai.net/en/image/multiplecharacters/) | 기본/캐릭터/부정 입력 분리, 순서·커스텀 위치, V4 계열 6명·V5 22명, V4/V4.5 5×5 위치 UI | 그리드와 API 좌표의 정확한 양자화 규칙 |
| [공식 Vibe 설명](https://docs.novelai.net/en/image/vibetransfer/), [Precise Reference](https://docs.novelai.net/en/image/precisereference/) | 서로 다른 참조 기능과 별도 설정이 존재 | 모델별 전처리·지원 조합·실제 바이너리/인코딩 계약 전체 |
| [공식 스텝·가이던스](https://docs.novelai.net/en/image/stepsguidance/), [시드](https://docs.novelai.net/en/image/seed/), [샘플링](https://docs.novelai.net/en/image/sampling/) | 화면 입력 의미와 모델별 기능 검토 단서 | 샘플러 ID·noise schedule의 모델별 서버 허용 목록 |

환경의 직접 HTTP 취득은 403이었고, 공식 문서는 검색 도구의 본문 열기로 확인했다. 스키마 전체의 로컬 원본이나 해시를 확보했다고 주장하지 않는다. 타사 SDK·블로그는 API 계약의 확정 근거로 사용하지 않았고 외부 소스 코드를 가져오지 않았다.

## 모델·기능 상태

| 대상 | 기존 앱 / 새 설계 | 이번 범위 | 실제 연결 상태 |
| --- | --- | --- | --- |
| V3 Anime/Furry·I2I·Inpaint | 기존 `nai.ts`의 매핑 유지 | 기존 세션·시드·프리셋 보존 | 현재 공식 API로 재검증하지 않음 |
| V4.5 Full | 첫 신규 연동 목표 | 6캐릭터 초안·기본 요청 투영 | ID·필수값·기본값 확인 후 P0-03b에서 바인딩 |
| V4.5 Curated / V4 | 비교·후속 후보 | 자동 변환·신규 연결 없음 | 미검증 |
| V5 Full/Curated | 현재 공식 모델로 조사 | 22캐릭터 입력 한도 설계, 공통 필드 구조만 투영 | 모델별 특수 옵션·ID·좌표 규칙 확인 전 연결 금지 |
| Vibe / Precise Reference | 서로 별개인 기능 | 기존 데이터 유지, 새 초안에서는 제외 | V3의 raw reference 배열을 최신 모델에 그대로 보내지 않음 |
| 최신 I2I·Inpaint·Director·스트리밍 | 별도 작업 | 기존 기능의 경로 유지 | 새 프로토타입에서 구현하지 않음 |

위 “현재”는 조사일의 문서 상태다. 서버가 요청을 수락한 결과나 배포 지원 선언이 아니다. 토큰 길이·과금·무료 생성 한도는 문자열 길이로 추정하거나 V3 계산을 재사용하지 않는다.

## 인증·엔드포인트·응답

| 항목 | 공식 확인 / 프로젝트 결정 |
| --- | --- |
| 이미지 생성 | `POST https://image.novelai.net/ai/generate-image` |
| 인증 | 공식 통합 안내는 사용자 Persistent API token을 Authorization 헤더에 사용하도록 요구한다. 신규 연동은 이 방식으로 설계 |
| 기존 인증 | 현재 `nai.ts`의 email/password 로그인과 `TOKEN.txt`, LoginService는 그대로임. 이번 프로토타입은 이를 호출하지 않음 |
| 새 토큰 저장 | OS 보안 저장과 세션 한정 사용을 별도 인증 PR에서 구현. 토큰을 초안·생성 기록·로그에 넣지 않음. 저장 보안이 구현됐다는 뜻은 아님 |
| 응답 | Swagger는 ZIP과 JSON을 표시하고, JSON은 `images[]`의 image/index/seed 필드를 정의. 최초 연동은 기존 ZIP 경로 유지가 목표이며 JSON/스트리밍은 후속 |
| 오류 | 공식 문서의 인증/서버 오류 정의와 상관 ID 헤더를 확인. 요청 실패를 이미지로 저장하지 않고, 자동 재시도·자동 비용 산출은 아직 추가하지 않음 |

실제 생성은 사용자 조작으로 시작하는 대기열을 유지한다. 타이머나 자율 반복 생성은 신규 설계 범위가 아니다. 실제 API 검증은 별도 요청과 비용 범위 안에서 수행하며 이번 작업은 자격증명·과금 없이 진행했다.

## 초안 → API 필드 표

`src/renderer/backends/genVendors/naiPreviewContract.ts`는 독립된 순수 프로토타입이다. 아래 투영은 필드 구조와 우리 초안의 변환 정책을 검증한다. 공개 스키마가 모델별 완성 요청을 정의하지 않으므로 이것만 실제 API에 보내면 된다는 뜻이 아니다.

| 메모리 초안 | 투영 필드 / 정책 | 근거·경계 |
| --- | --- | --- |
| prompt / negativePrompt | input, negative_prompt 및 양쪽 condition의 base_caption | 공식 필드 존재. 품질/UC 프리셋 자동 추가는 제외 |
| characters[] | 양쪽 condition.caption.char_captions[] | enabled만 선택하고 동일 순서를 사용. ID는 내부 대응용이며 전송하지 않음 |
| character prompt / negativePrompt | char_caption | 부정 입력의 누락·다른 캐릭터로의 이동 방지 |
| position | centers[{x,y}] | 양쪽 condition의 좌표를 대응. 0..1은 현재 초안 정책이며 모델별 좌표 해석은 추가 검증 |
| placement | use_coords, use_order | auto는 저장된 수동 좌표를 보내지 않고 빈 centers를 사용. use_order=true는 프로젝트 투영 정책 |
| family | 직접 전송하지 않음 | 캐릭터 한도·향후 기능 구분용. API model ID를 family명에서 추정하지 않음 |
| 해상도·스텝·시드 | width, height, steps, seed | 임의 난수로 바꾸지 않고 seed=0도 보존. 초안의 양의 정수·uint32 검사는 로컬 정책 |
| guidance / cfgRescale | scale / cfg_rescale | 유한 수와 로컬 범위 검사. 서버 지원 범위 확정과 구분 |
| sampler / noiseSchedule | sampler / noise_schedule | 명시값만 통과. 모델별 지원 목록과 기본값을 추측하지 않음 |
| 요청 개수 | n_samples=1 | 기존 앱 대기열이 반복 횟수를 관리. 서버 배치와 중복 계산 방지 |
| action / params_version | 이번 투영에서 생략 | 공식 타입은 있지만 모델별 의미·필수값 미확인. 라이브 바인딩의 선행 확인 항목 |

기본 프롬프트의 `|` 분할 문법은 새 초안에서 거부한다. 별도 캐릭터 상자와 섞거나 기존 프롬프트를 암묵적으로 분해하지 않는다. `<모음.조각>`·multi 문법의 기존 전개는 이번에 바꾸지 않았다.

## 저장·복구 경계

현재 `Session.version=1`과 새 초안의 version=1은 서로 다른 객체의 버전이다. 초안은 저장하지 않으며 기존 `Session.fromJSON`/워크플로 생성자도 변경하지 않는다. 따라서 저장 마이그레이션이 완료됐다고 표시하지 않는다.

소스 대조 결과, WorkFlowService.presetFromJSON/sharedFromJSON은 모르는 type을 오류로 처리한다. 최신 필드를 V3 preset에 덧붙이거나 새 workflow를 기존 세션에 바로 저장하는 방식은 이전 앱에서 읽기 실패·정보 손실을 낼 수 있다. 후속 저장 PR은 아래를 먼저 갖춰야 한다.

1. 이전 V3 세션을 읽어도 모델·프롬프트·시드·Vibe·인페인트 설정이 그대로 복원되는 fixture.
2. 기존 세션의 원본 복사와 별도 현대 모델 프로젝트 생성. 자동 덮어쓰기·동일 파일의 무조건 버전 승격 금지.
3. 새 schema/workflow를 구분하고 모르는 버전은 수정 저장하지 않기. 구버전으로 되돌릴 때 원본 복구 경로 제공.
4. 생성 요청의 최종 전개 프롬프트·명시 모델·시드를 토큰 없는 별도 기록으로 남기기. 이 기록은 PNG 내 원본 메타데이터를 대체하지 않음.

응답 프로토타입은 ZIP의 폴더/텍스트 항목 뒤에서 PNG를 선택하고, 샘플 1개 요청에 PNG가 0개/여러 개면 오류로 처리한다. CRC와 PNG 서명을 확인한 뒤 **바이트를 그대로 반환**해 메타데이터·알파를 재인코딩하지 않는다. 실제 전송에 연결하기 전 압축 해제 크기 제한·취소 및 HTTP content-type/오류 처리를 추가해야 한다.

## 완료와 다음 작업

P0-03a: 공식 근거·범위 결정, 저장 호환 설계, 합성 요청 snapshot과 ZIP/PNG 바이트 검증 8건을 완료했다. `npm run test:nai-contract`, 독립 모듈 엄격 타입검사·린트 통과. P0-03a 당시에는 앱에 미연결이었다. P1-01에서는 mock 화면의 입력 검사·예제 투영에만 연결하고 계정·실제 전송·세션 저장에는 연결하지 않는다.

P0-03b: 정확한 API 모델 ID와 action/params_version, 모델별 sampler/noise schedule/defaults, 실제 좌표 해석, 참조 전처리, 인증 및 저장·복구 구현을 별도 검증한다. 완료 전 P1-02 실제 연결을 켜지 않는다. P1-01은 위 범위의 오프라인 화면부터 진행할 수 있다.


## PR #4 추가 검토 결정

- `|`는 기본/부정 및 모든 캐릭터 입력(비활성 메모 포함)에서 거부한다. V3 프롬프트 믹싱과 V4 계열 캐릭터 구분자의 의미 충돌을 피하고 자동 변환하지 않는다.
- 빈 기본 프롬프트는 활성 캐릭터 프롬프트가 있으면 허용한다. 긍정 입력이 전부 빈 요청은 거부한다. UI도 같은 계약을 사용한다.
- 부정 조건의 use_coords/use_order 및 auto의 빈 centers 배열이 모델별로 필수/무시/거부되는지는 P0-03b 체크 항목이다. fixture는 모든 관련 ID를 가짜 값으로 바꿨으며 실제 기본값이 아니다.
- 새 전송의 프로세스·오프라인 경계는 D-013, V3 표시/편집·격자 원본은 D-014에 정했다. 입력 길이 초과 오류를 읽을 수 있게 보여주는 자리는 P1-01에 포함하되 토큰 수를 글자 수로 환산하지 않는다.


### P0-03b 전송 제어 추가 요구사항 (PR #6 검토)

- IPC/전송 경계 모두 오프라인 선행 거부, 요청 시간 제한, AbortSignal 전파 및 정리.
- 쿨다운/자격 확인 대기 뒤 **실제 전송 직전** 중지 상태 재확인. 아직 전송하지 않은 작업은 pending으로 복구하고 같은 작업 ID·결정한 요청/시드를 유지.
- 전송한 요청은 취소해도 서버 처리·과금 여부가 불명확할 수 있다. 결과 기록은 구분하고 자동 재시도하지 않음. 합성 전송기와 지연 응답으로 검증 후 별도 비용 범위 실호출.


### P0-03b1 구현 상태

[메인 인증·전송 기반](NAI_AUTH_TRANSPORT.md)을 구현하고 합성 fixture 및 실제 Electron/루프백 응답으로 검증했다. 인증 IPC만 앱에 연결됐고 전송기는 제품 생성 경로에서 미사용이다. 기존 TOKEN.txt·V3 로그인·세션은 유지한다. 2026-11-21 공식 doc.json의 Persistent API token/Bearer 설명을 다시 확인했으나 실제 토큰/모델 요청은 보내지 않았다. 모델 등록·인증 UI/실제 유효성·ZIP 해제 한도·저장 호환은 P0-03b2다.


### P0-03b2 인증 화면 부분 구현

포크 식별과 토큰 입력·로컬 읽기·삭제/복구 화면을 연결했다(D-026/027). 계정 인증·이미지 요청은 하지 않는다. 2026-11-21 공식 Image API doc.json과 공식 모델 문서를 다시 확인했지만 모델 ID enum, 모델별 필수값/기본값은 여전히 공개 근거로 확정하지 못했다. 자리표시 요청을 실제 모델 바인딩으로 바꾸지 않았다. 모델·ZIP 해제 제한·프로젝트 저장은 남은 범위다. 실호출 검증 시 실제 MIME/상태별 안내와 별도로 선택한 제한적 로컬 진단을 확인한다.


## P0-03b2 메인 응답 추가 — 2026-11-21

main/nai/transport.sendImage와 imageResponse.ts로 제한 ZIP 해제·CRC/PNG 구조·원본 바이트 보존·공유 기한/취소 경계를 구현했다. 실제 NovelAI 호출/모델 바인딩은 없다. 단일 엔트리 응답 형식과 한도는 우리 정책이며 서버 호환을 확정한 값이 아니다. fixture용 readPreviewPNGZip과 구분한다. [검증](validation/2026-11-21-image-response.md).

같은 날 공식 doc.json을 다시 열었지만 image.ImageGenerationRequest.model은 여전히 string이며 모델별 ID enum·action/params_version 조합을 확정하지 못했다. 타사 구현의 ID/기본값을 공식 계약으로 옮기지 않는다. [최소 실호출 검증 계획](NAI_LIVE_VALIDATION.md)의 계정·비용 범위가 정해지기 전 실제 인증/생성 호출은 하지 않는다.


## P0-03b2 연구 후보 추가 — D-032

공식 스키마에 model ID enum·모델별 action/params_version 기본값이 없는 상태는 유지된다. 이번에는 서버 수락 여부를 조사할 **미확인 연구 fixture** nai-live-candidate.json을 별도 도구에서만 사용한다. nai-diffusion-4-5-full/generate/3, sampler=k_euler_ancestral/noise_schedule=karras 등은 실험 가설이다. 운영 지원 목록이나 UI 기본값으로 등록하지 않는다. 기존 mock 투영의 fixture-… 값은 바꾸지 않는다.

사용자의 실험 위임에 따라 고정 후보 1회를 전송할 도구와 사전 수동 비용 확인/원문 보관을 준비했다. 실제 토큰은 아직 사용하지 않았으며 서버 수락·실제 MIME/ZIP·청구는 미확인이다. 첫 기본 이미지가 성공하더라도 캐릭터 긍정/부정·격자·V5·신규 저장 호환·실제 대기열은 별도 검증한다. [정확한 후보와 실행 조건](NAI_LIVE_VALIDATION.md).


## 첫 사용자 실측 — 2026-11-22

사용자가 후보 해시f9ab339756a902823b94d47a26e37e872537b3ff3d05526c7baa15e4999f68a5로1회 전송해 HTTP200·ZIP시작부(flags8/method8/extra0)를 보고했다. 이는 해당 요청의 첫 응답 관찰이며 모델별 의미/정확한 MIME/PNG 전체 검증이나 공식 규격 확정은 아니다. 연구 capture의 미분류 MIME 처리로 응답이64KiB에서 잘렸고, D-034가 수신 경로만 보완한다. 후보 필드·seed0·기존 mock 투영과 운영 모델 목록은 그대로다. 캐릭터/좌표·새 프로젝트 저장·실제 대기열 연결은 계속 후속이다. [관찰/추가1회 조건](NAI_LIVE_VALIDATION.md).


## 같은 후보의 기본1장 성공 관찰 — D-035

2026-11-22 사용자 두 번째 결과는 같은 해시f9ab…의 HTTP200/전체ZIP609317바이트/PNG검사·609129바이트 저장 성공이다. MIME분류other는 유지됐으나 ZIP시작부 수신경로와 엄격 해석을 통과했다. 이 고정된 기본1장 후보는 경험적 성공으로 기록한다. 공식 enum/기본값·모델별 파라미터 의미·캐릭터/좌표·seed metadata·V5 및 제품 대기열 연결을 검증한 것은 아니다. 원본을 받지 않았으므로 픽셀/화질/프롬프트 의미도 독립 확인하지 않았다.

Opus에 대한 사용자 설명은 Anlas관찰차이0과 구분하고 할당량 전후미측정으로 남긴다. [공식 구독 문서](https://docs.novelai.net/en/subscription/)의 모델별무료/사용량 범위를 참고하되 추가계정API조회나 무료추정은 하지 않는다. [성공 기록](validation/2026-11-22-live-success.md). 다음은 신규 저장/복구이며 추가실호출은 필요하지 않다.
