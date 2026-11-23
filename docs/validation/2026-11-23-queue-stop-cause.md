# 이번 큐 중단 원인·충돌 씬 제외 검증

작성일: 2026-11-23 (Asia/Seoul). 기준 main `d6887629ef8640b8442af382142696b3baf39b76`, 런타임 `1de38f73c924bdc9f3de6afc967aea4e3d22408c`, tree `e0179e39aeb7e3d5c3ec549bb98b7013658ee78e`. [정제 JSON](2026-11-23-queue-stop-cause.json), [PR24 처리](../reviews/2026-11-23-pr24-followup.md), [D-045](../DECISIONS.md), [사용](../WORKSPACE_QUEUE.md).

## 재현과 수정

기존 acceptQueue는 첫 item.error를 골라, 첫429 뒤 이어가기에서 TIMEOUT/저장 실패가 나도 이전429를 표시했다. main stoppedItemId와 renderer queueOutcome으로 이번 중단 항목만 고른다. pointer가 없거나 해소된 작업이면 과거 첫 오류로 fallback하지 않는다. result-pending은 별도로 즉시 반영하며, 새 run/preparing에서는 과거 pointer/error를 정리한다.

충돌 씬의 pending만 skipped로 바꾸는 메모리 조작을 추가했다. 현재 QUEUE_INPUT_CHANGED가 가리키는 씬·큐 ID·confirmed=true·main idle이어야 한다. 제시한 건수 확인 뒤에도 전송0이고 파일/입력/PNG/전송된 작업을 바꾸지 않는다. 나머지 pending은 새 확인이 필요하다.

## 단위·타입·빌드

- 전체193/193·실패0·건너뜀0: queue33/presentation5/generation16/projectReads8/store13/controller8/service-close10/main-auth-transport36/response19/offline11/workspace14/contract10/network-mode10.
- 429→이어가기→TIMEOUT,429→새 PNG 저장 실패의 실제 서비스 상태를 renderer helper에 전달해 현재 문구/미저장 상태를 확인했다. 과거 실패 이력은 남지만 현재 원인을 가리지 않는다. 저장-only 성공·명시적 버리기와 preparing 진입의 오류 정리도 검사했다.
- 충돌 씬 pending2건만 제외, false 확인/다른 큐·씬/중복 호출 거부, 파일 바이트/입력 불변·전송0·다른 pending3건의 새 확인, 전체 제외 후 전송0, active/미저장 PNG 제외 거부, 신뢰 프레임 검사를 확인했다.
- 마지막 UI 메타데이터 갱신 보완 뒤 관련62건을 재실행해62/62 통과했다. 전체193건을 그 보완 뒤 다시 전부 실행했다고 기록하지 않는다.
- 변경 TS/TSX7개 lint·scoped strict tsc·CJS format/문법 통과. main/worker/renderer production 빌드 후 최종 UI로 renderer와 고지 묶음을 다시 만들고 패키징했다. 새 npm ci/native rebuild는 수행하지 않았다.

## 실제 Electron·ASAR

| 검사 | 결과 |
| --- | --- |
| 새 queue-errors/create·reopen·offline3PID9체크 | 통과 |
| 기존 queue/reopen/offline3PID10체크 | 통과 |
| 최종 Linux ASAR generation-errors7체크 | 통과, app.isPackaged=true·프로필 격리·ASAR 불변 |
| 고지250사본 hash·143번들 발생·112runtime metadata | 통과, 기존8건 미해결 유지 |

새 create 시나리오는 HTTP429 → 다음 이어가기1건 성공/다음 TIMEOUT → 다음 이어가기 PNG 저장 실패 → 새 프로젝트에 결과만 보관을 거친다. TIMEOUT/저장 실패 때 **status/queueStatus 응답을 보류**해도 direct runQueue 응답으로 TIMEOUT 문구와 사용 가능한 저장 복구 버튼이 나타난다. 제품90초 timer는 하네스에서만900ms로 줄였다. 제품 옵션/기한·요청 정책을 바꾼 것이 아니다.

그 뒤 새 프로젝트에서2씬×2회의 미전송 예약을 만들고 한 씬의 입력을 바꿔 충돌을 재현했다. 제외 체크 전 버튼 비활성, 체크 뒤 해당2건만 skipped·다른2건 pending·현재 입력/PNG 유지, 남은2건 새 확인·확인 취소/큐 비우기에서 전송0을 확인했다. 전체 create PID의4회는 **loopback HTTP 횟수**이며 저장/제외/재확인 취소에서 다섯 번째 요청은 나가지 않았다. 실제 계정 호출0이다. 다음 PID/오프라인은 결과-only 프로젝트의 PNG를 byte-identical로 다시 열었다.

초기 GUI 시도는 오류/복구4체크까지 통과한 뒤 충돌 제외 영역을 기다리다 실패했다. 예약 직후 UI의 queue ID가500ms 폴링에 의존하던 문제였다. 준비 성공/실패 직후 main queueStatus를 직접 반영하고 로컬 작업 세대가 지난 폴링은 버리도록 보완했다. 검사 기준을 낮추지 않았고, 최종 앱/ASAR에서 같은 시나리오를 통과했다.

패키지 worker는 dist/main/projectWorker.js의 ASAR 논리 파일(unpacked=false)이다. archive SHA-256/실행 전후 불변은 JSON에 기록했다. 원격 요청/renderer 오류는 모든 최종 보고서에서0이다. singleton 잠금·390px 최소폭은 테스트 대체이며 package는 loopback inspector로 하네스만 주입한다. 제품 ASAR을 수정하지 않는다. 네트워크 목적지는 테스트에서만 loopback으로 바꾼다. 이번 후속은 동작/문구 검증으로 새 스크린샷 자산은 추가하지 않았다.390px 검사 시점은 충돌 처리/큐 비우기 뒤다.

Linux x64·Node22.4.1·Electron26.6.10(Node18.16.1)·builder24.13.3. npm11.19.1은 Node22.4.1 미지원 경고를 내므로 권장 조합이 아니다. 실제 계정1장/반복·정확한 MIME·429 빈도/간격·정상 OS 키링·Windows/macOS·256 MiB 지연·worker 복사 비용은 미측정이다. 전체 저장소 tsc의 기존 TS2688은 유지하며, 고지 사본 확인이 전체 재배포 허용 판정이라는 뜻은 아니다. 새 모델/해상도/캐릭터·와일드카드·자동 재시도·영속 큐는 이번 범위가 아니다.
