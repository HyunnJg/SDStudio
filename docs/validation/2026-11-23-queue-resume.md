# 미전송 씬 입력 범위·전송 전 복구 검증

작성일: 2026-11-23 (Asia/Seoul). 기준 main `2430216b5e4612a16ed3049c0d7359619753c089`, 런타임 `b2d005cb2cec6b119b9e2fd56752046053727d8a`, tree `a963d8ec0a7cae274c433578508ec2b2ee47cc15`. [정제 JSON](2026-11-23-queue-resume.json), [PR23 처리](../reviews/2026-11-23-pr23-followup.md), [D-044](../DECISIONS.md), [사용](../WORKSPACE_QUEUE.md).

## 재현과 정책

PR #23의 기존 비교는 프로젝트 name/selectedSceneId/모든 scenes를 JSON 비교했다. 429 뒤 다른 씬을 보기만 해도 저장된 selectedSceneId가 달라져 이어가기가 막혔다. 변경 후 동일 helper가 pending/preparing task의 scene ID/저장 draft 전체만 deep equal 비교한다. 메타데이터·예약 밖·완료/실패 작업만 참조하는 씬은 제외하며 객체 key 순서 차이는 허용한다. 승인된 body·시드·hash는 바꾸지 않는다.

| 재현 | 기대 결과·확인 |
| --- | --- |
| 429 후 프로젝트/예약 씬 이름 변경, 다른 씬 보기, 예약 밖 프롬프트 수정 | 미전송4건을 원래 시드로 확인/실행. 이미 전송된2건은 재전송하지 않음 |
| 첫 실행 전 metadata-only 리비전 변경/예약 밖 씬 삭제/씬 순서 변경 | 같은 예약 draft이면 최신 리비전으로 실행 |
| 완료한 씬 입력 수정·실패한 씬 삭제 | 그 씬에 pending 작업이 없으면 남은 다른 씬 실행 허용 |
| pending 예약 씬 프롬프트/부정 입력 변경·삭제 | QUEUE_INPUT_CHANGED/conflictSceneId, 전송 전 현재 작업도 pending 유지. 원복 후 같은 미전송 항목을 새 확인으로 실행 |
| 전송 전 저장 worker preflight 실패 | pending/오류 보존, 기존 ticket 소비. 복구 후 새 확인 전에는 전송0 |
| sendImage 진입 뒤 실패, mayHaveReachedServer=false | 여전히 failed, 이어가기 제외. flag만으로 자동 복원하지 않음 |
| 씬 삭제 후 체크 목록 | 렌더/prepare 인자에서 삭제 ID 제외. 변경 없는 배열은 같은 참조 |
| 신뢰하지 않은 IPC/부적절한 conflictSceneId | 발신자 선행 거부, ID는 QUEUE_INPUT_CHANGED의 로컬 ID100자 형식만 허용 |

## 검증

- 단위183/183, 실패0·건너뜀0. queue25/presentation3/generation16/projectReads8/store13/controller8/service-close10/main36/response19/offline11/workspace14/contract10/network-mode10.
- 변경 TS/TSX5개 scoped lint, 새 presentation/main/IPC/preload 경계 scoped strict tsc, 테스트/하네스 format·문법, main/worker/renderer production 빌드 통과.
- 실제 production Electron queue/reopen/offline3PID10체크 통과. 큐 중지 뒤 프로젝트 이름/보고 있는 씬을 바꾸고 예약 입력을 수정하면 로컬 씬 이름 안내·추가 요청0·pending5 유지. 원복 후 같은5건만 확인/실행했다.
- 실제 Linux ASAR의 generation-queue8체크 통과. app.isPackaged=true, 원본 프로필 격리, 실행 전후 ASAR 불변. worker는 dist/main/projectWorker.js의 ASAR 논리 파일(unpacked=false)이다.
- create PID의13회는 loopback HTTP 횟수다(6완료+1취소+5완료+1결과 저장 복구). 새 충돌 재현에 추가 네트워크를 쓰지 않았고 저장 복구도14번째 요청을 보내지 않았다. 단일 기본 바인딩·PNG 원본/메모리 pending·저장-only 새 프로젝트 복구·오프라인 재열기 경계를 유지한다.
- 실제 패키지 고지250사본 hash/번들143발생/런타임112metadata 대응 검사 통과. 기존8건 미해결·completeRedistributionReview=false는 유지한다.

이번 실제 계정 호출0, 보고서의 원격 요청/renderer 오류0이다. 테스트는 합성 토큰·알파/메타데이터를 가진 PNG를 loopback 응답으로 사용했다. singleton 잠금·390px 최소폭은 테스트 대체이며 package는 loopback inspector로만 하네스를 주입한다. 제품 archive는 수정하지 않는다. 텍스트 안내/동작 후속이므로 새 스크린샷 자산은 추가하지 않았다.

Node22.4.1/Electron26.6.10(Node18.16.1)/builder24.13.3/Linux x64. npm11.19.1은 Node22.4.1 미지원 경고를 내므로 권장 설치 조합이 아니다. 기존 의존성 재사용, 새 npm ci/native rebuild 미실행. 전체 저장소 tsc의 기존 TS2688, Windows/macOS·실제 키링·실제 계정1장/반복·정확한 MIME·429 빈도/호출 간격·256 MiB 지연/worker 복사 비용은 미검증이다. 새 비용 계산·고정 간격·자동 재시도·모델/해상도·와일드카드·저장 형식 확장은 포함하지 않는다.
