# 작업별 PNG 검사·읽기 횟수 검증

작성일: 2026-11-23 (Asia/Seoul). 기준 main `23d4c6adf7f3bbd9a58bda078fd96a06e15c24fd`, 런타임 커밋 `80a2968582c60705e50318baf017ee5bc3e978ae`, tree `40220a08c4bb2a0222aad1157cdc0c15d70e33e8`. [정제 결과 JSON](2026-11-23-project-reads.json), [PR21 의견 처리](../reviews/2026-11-23-pr21-followup.md), [D-042](../DECISIONS.md).

## 파일 읽기 횟수

120개 서로 다른 합성 PNG, 파일 합계3,947,880바이트를 임시 전용 프로필에 만든다. 같은 해시 파일을120개 기록에 재사용한 측정이 아니다. fs.openSync의 PNG 읽기 전용 open만 세며 wx 쓰기·manifest 읽기는 이 숫자에 포함하지 않는다. PNG는 테스트용 opaque 부가 청크를 포함하고 실제 사용자 이미지·키·계정 데이터는 없다.

| 코어 검사 | 읽은 PNG 파일 수 | 확인 |
| --- | ---: | --- |
| 명시적 open (120개 고유 파일) | 120 | 모든 참조 해시/크기 확인 유지 |
| 이전 선택 경로 open + readPNG 재현 | 121 | 같은 fixture에서 변경 전 동작을 직접 호출해 비교 |
| 변경 후 image(project UUID, image UUID) | 1 | 선택 PNG 원본과 바이트 동일 |
| prepare의 generationSnapshot (2회) | 0 | 기존 PNG 본문 없이 manifest/리비전/잠금/한도 검사 |
| run의 preflight + 고유 신규 PNG append | 0 | 기존 PNG 재읽기0회, 신규 PNG는 기존 구조/CRC/크기 검사 |
| 모호한 저장 응답 후 이미 커밋된 결과 retrySave | 1 | 해당 파일 손상 시 pending 유지, 복구 뒤 해제. API 합성 전송 총1회 |

생성 fixture는119개 참조/물리 파일로 전체 open을 먼저 통과시킨 후 하나를 외부 삭제해118개 물리 파일이 남는다. 유효한 다른 파일 선택과 metadata-only prepare/run은 계속되며, 새 결과 추가 후에도 분실된 참조는 보존한다. 다음 전체 open은 PROJECT_CORRUPT다. 생성 준비 성공을 전체 파일 무결성으로 오해하지 않도록 이 정책을 직접 검증했다.

선택 UUID 미등록·경로 입력·선택 PNG 손상/누락/기록 크기 불일치를 거부한다. 충돌 리비전·잔류 잠금·120장 상한도 PNG를 읽지 않고 거부한다. TS worker에서도 readManifest/image와 전체 open의 경계를 별도로 검증했다. ProjectController는 이미 반환된 스냅샷의 imageRecords를 복사하고 추가 open을 하지 않으며 새 프로젝트에서 목록을 비운다. 기본 seedMode=random과 명시적 fixed0 보존을 확인했다.

**이것은 파일 open 횟수 측정이다.** 256 MiB/120장 실제 사용자 프로젝트의 시간·디스크 캐시·지연 benchmark가 아니며, Electron UI/ASAR 자체의 open 횟수를 계측한 것도 아니다.

## 단위·타입·빌드

- 동일 Node22.4.1에서 단위155/155, 실패0·건너뜀0. 새 읽기 검사8, controller8, 기존 generation16/store13/service-close10/main36/response19/offline11/workspace14/contract10/network-mode10.
- 변경 TS/TSX6개 린트, 새/변경 CJS 테스트 포맷 통과. generation/service/worker/store/controller/ConnectedWorkspace 및 preload/type 경계의 scoped strict tsc 통과.
- npm run build의 main/worker/renderer production 빌드와 고지 수집 통과. 고지244레코드·미해결8건은 기존 상태 유지.
- Node22.4.1/Electron26.6.10(Node18.16.1)/builder24.13.3/Linux x64. 환경 npm11.19.1은 Node22.4.1 미지원 경고를 내므로 권장 설치 조합이 아니다. 기존 의존성을 재사용했고 npm ci/새 native rebuild는 수행하지 않았다. 전체 저장소 tsc의 기존 TS2688을 해결한 작업이 아니다.

## 실제 앱·ASAR 회귀

- 기존 smoke:generation: 실제 production 앱3PID/create·reopen·offline,8체크 통과. 준비/미확인 전송0, 합성 session 전송·worker PNG 저장/디코딩, 취소, 저장 실패 뒤 네트워크 재전송 없는 새 프로젝트 보관, 다음 PID PNG 재열기, 오프라인 이미지 보기/생성 거부,390px 가로 넘침 없음.
- smoke:project-ui: 실제 mock 앱2PID,7체크 통과. 선택 씬 저장, dirty 취소/폐기, 잔류 잠금 복사, 닫기 보류/저장, 손상 이력 복사 복구, 다음 PID 입력 복원.
- electron-builder Linux directory 패키지를 --publish never/npmRebuild=false로 생성. 설치된 Electron을 재사용했다. smoke:package의 generation6체크 통과. app.isPackaged=true, 테스트 전후 ASAR 불변, profileIsolated=true. projectWorker.js는 dist/main/projectWorker.js의 ASAR 논리 파일이며 unpacked=false다. 신규 image worker 명령으로 저장 PNG 표시까지 통과했다.
- 패키지 고지 사본250개 해시, 번들 패키지 발생143건·런타임metadata112개 대응 통과. 기존8건 미해결·completeRedistributionReview=false는 유지. --require-notice-files 완전 통과를 주장하지 않는다.

모든 앱 검사에서 실제 계정 호출0, 원격 요청0, renderer 오류0. 고정 생성 목적지는 하네스에서만 loopback으로 바꾸고 합성 토큰/PNG를 썼다. 실제 서버 MIME을 이번에 확인한 것은 아니다. singleton 잠금은 모의이며390px는 테스트용 창 최소폭 대체다. 패키지는 loopback inspector로 하네스만 진입 전에 주입하고 제품 ASAR을 수정하지 않는다. 임시 TOKEN.txt가 없어 발생하는 기존 read-file 로그는 사용자 자격증명을 읽은 결과가 아니다.

Windows/macOS·실제 사용자 키링·새 UI의 실제 계정 생성은 미검증이다. API 요청 body/고정 binding·티켓·취소/기한·예상 리비전 append·미저장 결과 정책은 바꾸지 않았다. 실제 반복 대기열 연결/최신 리비전 자동 append는 다음 P1-02b이고, 이번 변경에 추가 키 입력은 필요 없다.
