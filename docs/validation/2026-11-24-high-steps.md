# PR28 검토 보완 — 높은 스텝 조건부 확인

2026-11-24 (Asia/Seoul). 기준 PR28 c41da9e, 런타임 `61a89ae23f4ad47755bcd0ebebbeb5e91e67c37d`, tree `ac4671d97a6f69f5e9862ec8cd3f8830ed3cde52`. D-049. [정제 JSON](2026-11-24-high-steps.json), [검토 처리](../reviews/2026-11-24-pr26-28-followup.md).

## 변경

단일 생성의 메인 prepare plan.steps가28을 넘을 때만 확인 화면을 연다. 저장/준비까지는 전송0이며 실제 모델·크기·스텝·가이던스/시드를 표시하고 입력을 잠근다. 확인 영역으로 스크롤/키보드 포커스를 옮겨 사용자가 버튼을 찾게 한다. 확인을 누르면 그 ticket을1회 사용하며 취소는 main cancel로 준비를 버린다. 23/28스텝은 기존 원클릭이다. 큐는 승인된 settings 중 초과 설정이 있으면 기존 묶음 확인 안에 경고만 더한다. 무료 계산·체크박스·자동 재시도는 추가하지 않는다.

## 실행한 검사

| 검사 | 결과 |
| --- | --- |
| V5 binding7 + queue/presentation40 + generation16 + project UI18 + network10 + auth4 | 95/95·실패/건너뜀0 |
| 변경 TS/TSX2개 lint / scoped strict tsc | 통과 |
| production renderer / 고지 생성 / Linux directory package | 통과, 기존 deps 재사용·npmRebuild=false·publish never |
| unpackaged single/reopen/offline | 3PID·11체크·loopback3회 |
| unpackaged queue/reopen/offline | 3PID·10체크·loopback13회, 일반23스텝 묶음은 초과 경고 없음 |
| 최종 ASAR generation | 9체크·loopback3회·app.isPackaged=true·프로필 격리·실행 전후 archive 불변 |
| 실제 패키지 고지 |250 사본 hash·143번들 발생·112runtime metadata, 기존8건 미해결 유지 |

단일 GUI 순서는23스텝1회 성공 →29스텝 준비/취소(추가 요청0) →28스텝 원클릭 요청/취소 →29스텝 준비(추가 요청0)/확인 연속2번 클릭이다. 실제 요청 스텝 배열은 정확히[23,28,29]이고 세 번째 PNG의 저장 실패를 새 프로젝트 저장-only로 복구해 네 번째 API 요청이 없다. 이어서23/29가 섞인 큐를 준비하면 기존 확인 화면에 경고가 나타나며, 취소해도 추가 전송0이다. 다른 PID/오프라인 재열기에서는 이번 결과 PNG1장을 그대로 표시한다.

최종 ASAR 검사는 마지막 확인 영역 포커스/스크롤 보완과 최종 renderer 빌드 뒤 실행했다. 앞선 unpackaged 보고서는 보조 증거이며 같은 핵심 추가 시나리오는 최종 ASAR에서 다시 통과했다. 초기 package runner는 제품9체크가 모두 성공했지만 기존 기대치6 때문에 종료1이었다. 기대치를 추가된9체크로 갱신한 뒤 같은 패키지/요청3회 조건으로 다시 통과했다. 제품 확인/전송 기준을 완화하지 않았다.

Xorg dummy·테스트 전용 no-sandbox/singleton 대체·390px 최소폭 override·loopback 목적지·합성 토큰을 사용했다. app.asar에 테스트 코드를 넣지 않고 loopback inspector로 하네스만 주입했다. 원격 요청/renderer 오류0, 실제 계정 요청0이다. 정상 OS sandbox/keyring 검증으로 확대하지 않는다. 환경의 버스/udev 오류와 합성 TOKEN.txt 부재 로그는 남아 있다.

## 유지/미확인

메인 요청/전송/ZIP/PNG 파서·저장 형식은 바꾸지 않았다. V4.5 크기512×512·고정0/추가시드-1 규칙을 보존했다. V5 PNG 응답/음수 추가 시드의 실제 서버 수용·정확한 MIME·실제 사용량/출력 품질은 미확인이다. Node/Electron 변경/새 npm ci/native rebuild, Windows/macOS·정상 키링 성공은 이 작업에서 실행하지 않았다. 전체 tsc의 기존 TS2688과 기존 고지 미해결8건도 해결됐다고 표시하지 않는다.

Windows의 Node22 앱/Node26 빌드 도구·VS2026 기동은 [사용자 전달 기록](2026-11-24-windows-local-start.md)으로 따로 보존한다. 검토자 Claude가 보고한227건과 이번 구현 담당자의95건은 다른 실행이다.
