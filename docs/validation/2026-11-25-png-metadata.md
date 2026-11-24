# PNG 항목별 가져오기 검증 — 2026-11-25

기준 PR35 병합 `b3fb84b`, 브랜치 `work/png-metadata`, D-056. host Node26.13.1/npm11.21.3, Electron45.4.1, Linux x64. 사용자 이미지/계정/토큰 없이 합성 PNG와 루프백만 사용했다.

## 코드/단위/빌드

- 단위 **290/290**(기존275+PNG 메타데이터15) 통과. tEXt/압축·비압축iTXt/zTXt, 한국어, 알파 열 우선/MSB/gzip·비트 길이, 텍스트 우선/알파 복구, CRC/청크/픽셀/크기/압축 출력, 취소, 항목별 적용·seed0·배열 대응/상한·지원되지 않는 설정/참조를 확인했다. 기존 운영 ZIP/PNG CRC 회귀도 포함한다.
- 새 fixture는 native zlib.crc32로 CRC를 만들고 제품은 기존 JS CRC를 공통 모듈로 이동해 쓴다. 외부 원문·개인 이미지에 의존하지 않는다.
- 변경7개 TS/TSX eslint, parser/planner/새 dialog/이력 컴포넌트/CRC의 독립 strict tsc 통과. ConnectedWorkspace까지 따라가는 넓은 tsc는 기존 미변경 App.test/main/ElectronFetcher/libsodium/legacy 모델 타입 오류로 실패했다. 새 변경 파일 진단은 없었지만 전체 타입 검사 성공은 아니다.
- `npm run lint`의 외부 dist TypeError는 더 발생하지 않았다. 전체 소스에서는 기존 **3044오류·31경고**가 남는다(정리 전 기준에서 dist를 제외해 측정한 수와 같음). 규칙을 끄거나 서브모듈 소스를 수정하지 않았다. 전체 lint 성공이라고 표시하지 않는다.
- production main/renderer/고지, 최종 전체 빌드, Linux 디렉터리 패키지·고지 검사 통과. packages215/고지 사본219, 원문8 미해결 유지. 새 의존성/lock 변경·서명·공개 배포는 없다.

## 실제 Electron

각 경로는 create/reopen/offline의 서로 다른3PID로 실행했다.

| 경로 | 체크리스트 | 합성 루프백 생성 |
| --- | ---: | ---: |
| 기본 생성/복사 캐시/PNG 가져오기 | 30 | 3 |
| 캐릭터 생성·가져오기 오프라인 | 18 | 3 |
| 반복 대기열·가져오기 오프라인 | 18 | 13 |
| 오류/저장 복구·가져오기 오프라인 | 17 | 4 |

총 **12PID·83체크**, 루프백23회이며 실제 계정 요청 수가 아니다. 원격 요청0·renderer 오류0·원본 프로필 파일 생성0·네이티브 종료를 확인했다. 단일 인스턴스 잠금은 하네스에서만 모의다.

- 실제 FileList/DragEvent를 주입해 같은 제품 핸들러로 텍스트 미리보기/취소·시드만 적용·알파 메타데이터 전체 적용을 확인. OS 파일 선택 대화상자를 사람이 조작한 검사는 아니다.
- PNG는 제품의 createImageBitmap/OffscreenCanvas와 Web DecompressionStream으로 해석했다. 캐릭터 순서·부정 배열·seed0·28/5.5 적용, 품질/UC 자동 추가 none, rescale0.2 제외 안내를 확인.390px dialog에서 수평 넘침이 없었다.
- HTML처럼 보이는 프롬프트는 DOM 태그/스크립트로 실행되지 않았고, 손상 파일은 고정 오류와 기존 입력 보존으로 끝났다.
- 닫기/적용 때 파일 미리보기 수명을 정리한다. createImageBitmap 완료를 검사에서150ms 지연시킨 뒤 닫아 늦은 결과가 dialog/입력을 되살리지 않는지 확인했다. 이미 시작한 native decode 자체의 취소를 검증한 것은 아니다.
- offline 프로세스에서도 같은 항목별 가져오기를 실행했고 생성 요청0이었다. 가져오기/취소 전후 프로젝트 목록의 UUID/리비전이 같았다. 이후 저장·생성은 기존 경로의 명시적 동작이다.
- 상위 gallery key를 제거한 화면에서 동일한30개 image UUID를 유지하는 새 복사본으로 전환했다. thumbnail IPC는 새 projectId만 사용했다. 이는 PR35의 실제 버그 재현이 아니라, 부모 재마운트 없이 컴포넌트 자체 격리를 검사한 것이다.
- 30개 UUID는 같은 합성 PNG를 참조하며 초기 image IPC5회·URL 정리/보이는 범위 읽기를 유지했다. 실제120개의 서로 다른 PNG에 대한 속도/메모리 측정이 아니다.

## ASAR와 진행 중 발견한 검사 문제

Linux 실제 디렉터리 패키지에서 generation **21체크**, characters **8체크** 통과(각 루프백3회). app.isPackaged=true·ASAR 전후 해시 동일·프로필 격리·원격/renderer 오류0을 확인했다. worker와 renderer는 제품 ASAR 번들이며 inspector는 검사 주입에만 사용했다.

초기 단위 검사에서 알파 magic 길이를14로 잘못 정한 구현 오류를 검출했고, 문자열 길이(`stealth_pngcomp`는15)를 기준으로 읽도록 고친 뒤 통과했다. 복사 탐침의 첫 비교에는 창 크기 변경 직후 기존 gallery 읽기가 포함돼 실패했다. 기존 읽기가 안정된 다음 복사 전환을 측정하도록 검사만 고쳤으며 제품의 격리 기준을 완화하지 않았다. TS DOM BufferSource와 기존 eslint no-undef의 타입 인식 차이는 해당 타입 줄에만 설명을 붙였다.

Windows/macOS 실제 창·사용자 PNG·실계정 생성·서명/FEC/RGB 은닉·WebP/EXIF는 미검증/미지원이다. metadata 복원은 결과 재현이나 진위 인증이 아니다. CI 결과는 PR 본문의 해당 head 링크에서 확인한다.
