# V5 Full 이미지 레퍼런스 — D-061

2026-11-25 (Asia/Seoul). 기준은 PR38 병합 main `e1e2134`다. 이번 범위는 **씬당 PNG 참조 1장**의 실제 앱 연결이다. 합성 요청·루프백·로컬 UI 결과를 공식 서버의 수용/화질 검증으로 표시하지 않는다. 사용자의 계정/이미지는 사용하지 않았다.

## 현재 근거와 독립 구현

- [2026-11-24 공식 출시 공지](https://journal.novelai.net/precise-reference-v5/)에서 V5 Full/Curated의 캐릭터·화풍·의상, 같은 의상 우선, Fidelity 제거, 강도 최대5, 참조당 생성마다 추가5 Anlas, V5 참조 인페인팅 미지원과 Opus 비용 설명을 직접 확인했다.
- [공개 API JSON](https://image.novelai.net/docs/doc.json)은 `director_reference_*`의 배열/타입을 제공하지만 설명은 아직 V4.5의 검은 패딩·강도0~1·Fidelity다. 이를 V5 전처리/옵션 근거로 사용하지 않았다.
- 현재 공식 [이미지 앱](https://novelai.net/image)의 **비로그인 공개 정적 자산**을 읽기만 해 통신 필드와 모델 기능을 대조했다. 확인 build ID는 `b2fe159-production`, 배포 식별자는 `b2fe159-45513015385-1`이다. 등록·로그인·생성 요청은 하지 않았다. 공식 앱의 코드·레이아웃 구현·이미지 자산을 복사하거나 의존성/저장소에 넣지 않았다. 아래는 상호 운용에 필요한 필드/값의 관찰이며 서버 보증은 아니다.

| 확인한 공개 자산 | 관찰 범위 |
| --- | --- |
| [22-cczt97ry1s.js](https://novelai.net/_next/static/chunks/22-cczt97ry1s.js?dpl=b2fe159-45513015385-1) | V5 Full은 참조 지원·bucket 변환·강도 최대5·Fidelity 없음·outfit 지원. 역할의 wire 문자열 |
| [09aajvaad_e63.js](https://novelai.net/_next/static/chunks/09aajvaad_e63.js?dpl=b2fe159-45513015385-1) | 배열 직렬화, V5의 Fidelity 입력을1로 정규화해 secondary를0으로 전송, reference base64 경로 |
| [2s4lj3fycctfh.js](https://novelai.net/_next/static/chunks/2s4lj3fycctfh.js?dpl=b2fe159-45513015385-1) | V5는 V4.5식 패딩이 아니라 비율에 따른 ~1MP/64px bucket·중앙 crop. 아래 앱의 세 크기는 그 목록의 부분집합 |
| [3phjyktz5p57y.js](https://novelai.net/_next/static/chunks/3phjyktz5p57y.js?dpl=b2fe159-45513015385-1) | 캐릭터/캐릭터·화풍의 같은 의상 토글과 역할 값의 대응 |

앱은 기존 sharp로 별도 작성한 전처리와 아래 고정 직렬화를 사용한다. 공식 앱의 전체 bucket 목록/리샘플러와 픽셀 단위 동일성을 주장하지 않는다. 공식 문서가 갱신되거나 API가 바뀌면 이 근거와 바인딩을 다시 검토한다.

## 사용자 흐름

입력 패널의 **이미지 레퍼런스 → 참조 PNG 선택** 또는 그 카드에 PNG 드롭 → 전송용 이미지 미리보기 → 역할/강도/같은 의상 설정 → 기존 생성 버튼이다. 이미지 교체는 역할·강도·의상 선택을 유지한다. 새 참조는 캐릭터·강도1·같은 의상 끔으로 시작한다(앱 기본값이며 최적값/공식 기본값 주장이 아님).

파일 선택은 현재 입력을 먼저 저장하고, 원본/파생 자산만 로컬에 추가한다. 새 참조 연결 자체는 편집 상태다. 다음 명시적 저장/생성 때 manifest에 보관하며, 미저장 입력 버리기 정책을 따른다. 선택만으로 업로드/생성하지 않는다. 참조 해제는 현재 씬의 입력에서만 제거한다. 과거 결과·원본 파일을 자동 삭제하지 않는다.

- 기본 프롬프트나 실제 캐릭터 프롬프트가 필요한 기존 생성 조건은 유지한다.
- 참조는 씬 전체 조건이며 텍스트 캐릭터 카드와1:1 대응/분리를 보장하지 않는다.
- PNG 메타데이터 가져오기는 별도 버튼/기본 작업실 드롭이다. 참조 카드의 드롭만 참조 선택이다. 메타데이터에 참조 흔적이 있어도 원본 이미지가 복원되거나 자동 첨부되지 않는다. 현재 씬의 참조 선택은 유지한다는 안내를 제공한다.
- V4.5로 바꿔도 선택을 지우지 않는다. 참조를 해제하거나 V5로 바꾸기 전 생성은 main에서 거부하며 무참조로 자동 전송하지 않는다.
- 단일 생성은 기존 원클릭, 반복은 기존 묶음 확인을 쓴다. 확인에는 참조 수·역할·강도·의상 선택과 추가 비용 안내가 들어간다. 앱이 최종 요금/무료 여부를 계산하지 않는다. 참조당5 Anlas는 공식 안내이며 이번 앱 실측 청구가 아니다.

## 지원/전송 계약

| UI | wire base_caption |
| --- | --- |
| 캐릭터, 같은 의상 끔 | character |
| 캐릭터, 같은 의상 켬 | character_mainoutfit |
| 화풍 | style |
| 캐릭터·화풍, 같은 의상 끔 | character&style_anyoutfit |
| 캐릭터·화풍, 같은 의상 켬 | character&style |
| 의상 | costume |

`director_reference_images=[전송용 PNG base64]`, descriptions는 `caption:{base_caption, char_captions:[]}, legacy_uc:false`, information_extracted=[1], strength_values=[선택값0~5], secondary_strength_values=[0]으로 보낸다. 의상/화풍에는 같은 의상 토글을 제공하지 않고 잘못된 조합은 거부한다. Fidelity UI는 없다. 기존 POST 목적지·토큰 경로·자동 재시도 금지는 유지한다.

무참조 요청은 기존 본문/바인딩 그대로다. 참조 요청만 `nai-v5-reference-v1`로 기록하고 실제 본문(파생 PNG 포함, 인증 제외)의 SHA-256을 저장한다. prepare의 티켓·고정 시드·역할·강도·의상·자산 해시에 묶이며 매 실행 직전에 원본/파생 파일 해시를 재검사한다. 승인 뒤 입력이 바뀌면 기존 단일 리비전/큐 draft 비교가 막는다. 손상/분실도 전송 전에 거부한다. 실패/중지/모호한 응답은 자동 재전송하지 않는다.

유효 PNG 응답 뒤의 기존 pending·저장-only 복구를 재사용한다. 새 프로젝트에 이번 결과만 보관할 때 참조 원본/파생도 함께 복사하며 이전 결과 PNG는 복사하지 않는다. 참조 파일 자체가 사라졌다면 복구는 실패로 남고 pending PNG를 자동 폐기하지 않는다.

## 자산·저장 형식·한도

- `WorkspaceDraft.reference`는 UUID, sourceHash/sourceBytes, uploadHash/uploadBytes, width/height, role/strength/preferSameOutfit만 포함한다. 경로·파일명·이미지 base64·계정 자료를 manifest나 확인 계획에 넣지 않는다.
- 원본 PNG는 바이트 그대로 `projects-v1/<UUID>/references/<sourceHash>.png`, 전송용 PNG는 같은 폴더의 `<uploadHash>.png`다. 원본/파생 해시가 같으면 파일을 공유한다. 기존 결과 `images/`와 구분한다.
- PNG만 지원한다. 원본32MiB·1600만 픽셀 이하, 애니메이션 미지원. 기존 PNG CRC/구조 검사와 sharp 디코딩을 모두 통과해야 한다.
- 전송용 크기는832×1216·1024×1024·1216×832 중 비율이 가까운 크기다. 비율 유지 resize 후 중앙 crop하며 알파를 보존하고 일반 PNG 텍스트 청크를 제외한다. 픽셀의 LSB 등에 숨긴 임의 정보까지 완전히 제거한다는 보장은 아니다. 화면은 실제 전송 파생본을 보여준다. 큰 가장자리 내용이 잘릴 수 있으므로 미리보기를 확인한다.
- 파생 PNG2MiB, 단일 JSON 요청4MiB, 예약 전체 본문8MiB 상한. 참조가 크면60건보다 적은 예약에서 한도에 닿을 수 있다. 자동 압축 품질 변경·타입 변경·참조 생략은 하지 않는다.
- 현재 참조 원본/파생의 고유 해시 바이트와 결과 PNG를 합쳐 기존256MiB 상한을 적용한다. 참조 폴더는 미저장/취소 후 고아 자산까지 포함해256MiB·360파일로 제한한다. 자동 정리는 없으며 새 복사본에는 manifest가 참조하는 파일만 복사한다.
- 참조 필드를 저장하는 프로젝트만 **version5**로 승격한다. v1~v4 읽기·이력 복구는 유지한다. 이전 앱은 v5를 거부한다. 원본/파생은 명시적 열기·복사·복구에서 검사하며 결과 선택은 기존 단건 PNG 검사다. 참조 없는 준비/저장에서 전체 결과 PNG를 다시 읽지 않는다.
- 파일 처리/디코딩은 기존 프로젝트 worker에서 한다. sharp의 비동기 호출 중 다른 저장이 끼어들지 않도록 worker 요청도 직렬화한다. 새 의존성은 없다.

새 generation IPC는 importReference(UUID, revision, PNG bytes)와 referenceImage(UUID, sceneId)다. import는 로컬 전용이며 원본/파생 검증·저장만 한다. 미리보기는 현재 manifest의 씬 참조만 읽고, 임의 경로/hash로 읽는 IPC는 없다. 프로젝트 create의 선택적 referenceSourceId는 같은 프로필의 UUID로 참조 자산만 복사한다. 기존 쓰기 결과의 불확실성·단일 인스턴스/같은 사용자 프로세스 경계는 유지한다.

Curated·다중 참조·임의 조합·참조 인페인팅·Vibe·JPEG/WebP 입력·수동 참조 crop·영속 대기열은 이번 범위 밖이다.

## 실행 확인

병합본에서 평소처럼 `npm install` → `npm run build` → `npm start` 후 V5 Full/832×1216·평소 프롬프트에 참조1장을 골라 미리보기를 확인하고1회 생성한다. 참조 비용은 Opus 무료로 가정하지 않는다. 실패하면 자동 재전송하지 말고 오류 코드/HTTP 상태를 확인한다. 이미지·키·원본 파일을 공유할 필요는 없다. 로컬 합성 검증은 `npm run test:reference`, Linux 화면 검사는 `npm run smoke:reference`다.
