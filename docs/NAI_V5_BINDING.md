# V5 Full 바인딩 근거와 한계 (D-048)

확인일: 2026-11-24 (Asia/Seoul). 앱의 기존 V4.5 기본512px 실측을 V5 실측으로 취급하지 않는다. 이 변경에서 실제 계정 요청은0회다. 사용자는 평소 V5 Full·832×1216을 쓰며 로컬 앱의 이전 출력 차이를 보고했다. 모델/해상도·품질/UC 설정 차이가 있으므로 먼저 설정을 맞추지만, 유화풍/기괴한 출력의 원인을 특정하거나 개선됐다고 주장하지 않는다.

## 일차 출처

공식 문서와 로그인 없이 내려오는 공개 웹 클라이언트의 상수/요청 필드를 읽었다. 직접 HTTP 접근403 후 공개 페이지 수집 도구로 원문 스크립트를 확인했다. 계정·토큰·로그인 세션·생성 API는 사용하지 않았다. 구현 코드를 복사/배포하거나 패키지/로고/이미지 자산을 가져오지 않았고, 사실 값/태그 선택을 바탕으로 별도 TypeScript 투영기를 작성했다. minified bundle 전체는 저장소에 넣지 않는다.

| 출처 | 확인 내용 |
| --- | --- |
| [공식 모델 문서](https://docs.novelai.net/en/image/models/) | V5 모델 구분/소개 |
| [공식 품질 태그](https://docs.novelai.net/en/image/qualitytags/) | V5 Standard/Light 품질 태그 |
| [공식 부정 프롬프트](https://docs.novelai.net/en/image/undesiredcontent/) | UC 프리셋과 직접 입력 |
| [공식 Effort](https://docs.novelai.net/en/image/effort/) | V5 effort/steps 구분. 이번 앱은 수치 스텝만 제공 |
| [공식 FAQ](https://docs.novelai.net/en/faq/) | Opus 조건/사용량은 모델·설정에 따라 다르며 앱이 무료 판정하지 않음 |

확인한 공개 빌드: `52e2e6f-production`, 페이지 배포 식별값 `52e2e6f-44850709975-1`. 아래 경로는 그날 관찰한 빌드별 청크로, 영구 공개/API 명세를 보장하지 않는다. 문자 수는 수집 도구가 반환한 rawHtml 문자열 길이이며 내려받은 압축 네트워크 바이트 수가 아니다. 별도 파일 해시/공식 API 계약은 수집하지 않았다.

| 공개 청크 | 문자 수 | 관찰 |
| --- | ---: | --- |
| [3100dxu3otx2h.js](https://novelai.net/_next/static/chunks/3100dxu3otx2h.js) | 2,272,599 | model enum nai-diffusion-5-full, Full high 기본832×1216/23/7·params_version4, Euler ancestral/Karras, 품질/UC 선택 |
| [36juzcfi11xq3.js](https://novelai.net/_next/static/chunks/36juzcfi11xq3.js) | 35,898 | v4_prompt caption/use_order/use_coords, negative caption/legacy_uc, extra_noise_seed=seed-1 |
| [3487yqc66pbwq.js](https://novelai.net/_next/static/chunks/3487yqc66pbwq.js) | 106,432 | input/model/action/parameters 요청, negative_prompt, V5 karras 및 Euler 부가 플래그, image_format=webp 후 내보내기 변환 |
| [1v2vs4jj1vr18.js](https://novelai.net/_next/static/chunks/1v2vs4jj1vr18.js) | 43,853 | 생성/stream endpoint 구분. 앱은 기존 비stream 생성 주소 유지 |

## 자체 구현 선택

- 새 바인딩 `nai-v5-full-v1`: Full high 설정을 기본으로 세로832×1216/가로1216×832/정사각1024×1024, 사용자 스텝1~50·scale0초과~10을 허용한다. 이는 앱의 제한이며 그 모든 조합을 서버에서 실험했다는 뜻이 아니다. Medium/새 모델·임의 sampler/endpoint는 열지 않는다.
- 품질 none/light/standard와 UC none/light/heavy/human/furry는 명시적 필드로 저장한다. 품질 suffix/부정 prefix를 적용한 최종 본문을 해시하며 실제 편집 초안은 바꾸지 않는다. 옵션이 없는 옛 V5 초안은 none으로 해석해 숨은 태그를 추가하지 않는다. 새 입력만 standard/heavy다.
- char_captions=[], use_coords=false, 양성 use_order=true, 음성 legacy_uc=false이며 활성 캐릭터/좌표/와일드카드·혼합 문법은 지원하지 않는다. 기존 seed0은 seed0으로 보내고 extra_noise_seed=-1이다. 서버가 seed0을 어떻게 해석하는지는 이번에 확인하지 않았다.
- **출력 차이:** 웹 클라이언트는 WebP를 요청하고 PNG 내보내기를 별도로 한다. 앱은 기존 제한 ZIP/PNG 원본 보관 경로를 유지하기 위해 **image_format=png**를 요청한다. 이 값이 현재 V5 서버에서 수용되는지 직접 확인하지 않았다. 웹과 완전히 같은 요청이라고 주장하지 않으며, 첫 실계정1장 확인 항목이다. 형식이 다르면 기존 고정 오류/서버 처리 불확실성을 남기고 자동 재시도하지 않는다.
- 기존 V4.5 binding/request 형태는 그대로다. V5 선택 필드/결과는 manifest v3, reader는 v1/v2/v3다. 선택한 모델의 새 설정은 저장/복구·혼합 큐에도 남는다.

## 확인한 것과 다음 확인

합성 요청의 최종 본문/해시·세 크기·프리셋·시드·v3 저장/복구와 V4.5 혼합 큐를 테스트했다. 실제 Electron 창/worker/loopback 전송과 PNG 저장·재열기·오프라인 표시도 검증했다. 합성 응답은 작은 PNG이므로 실제 V5 픽셀 수/모델/PNG 메타데이터·출력 품질 검증이 아니다.

실계정 확인은 사용자 로컬에서1장부터 한다. 출력 형식 실패면 재전송보다 기존 코드/진단을 먼저 확인한다. 토큰·사용자 이미지·원문 응답을 보내지 않아도 된다. [확인 절차](WORKSPACE_LIVE_CHECK.md). Node/Electron 현대화와 정상 OS 키링·Windows/macOS 검증은 이 바인딩과 별도다.
