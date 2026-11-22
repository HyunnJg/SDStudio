# 프로젝트 조작 화면·worker·닫기 검증 — 2026-11-22

- 기준: PR #18 병합 `0a13c31b227be82187903473deeb49c6a8914611`.
- 런타임: `fda9f812c68a3f57a863c2222915482ba023e4c7`, tree `f314331f9a18819170023c3b9b9fdf3dd63fe443`.
- 범위: D-039. Electron **오프라인 mock 작업실**의 명시 저장/열기·복사 복구·미저장/닫기 보호, worker I/O. 실제 생성·PNG 표시·큐 영속화는 미연결.
- [상세 정제 보고서](2026-11-22-project-controls.json), [정책/남은 항목](../PROJECT_STORAGE.md), [PR18 의견 처리](../reviews/2026-11-22-pr18-followup.md).

## 결과

| 검사 | 결과 | 확인 범위 |
| --- | --- | --- |
| test:project | 13/13 | 이전 저장/복구·원본 PNG/복사·형식/파일 보존. IPC await 전환 반영 |
| test:project-ui | 10/10 | controller5 + service/close5. 저장/미저장 의도·실패 유지·busy/limit copy·leave 확인·worker 응답/한도/실패·이력999→1000·메인 close 승인/reset |
| test:nai-main | 36/36 | 기존 토큰/전송/MIME 경계 |
| test:nai-response | 19/19 | 엄격 ZIP/PNG·로컬 재검사 |
| test:offline | 11/11 | 네트워크 진입점/차단 정책 |
| test:workspace / test:nai-contract | 14/14, 10/10 | 기존 메모리 큐·입력 투영 |
| test:network-mode | 10/10 | 기존 모드/재시작 준비 로직. 실제 온라인 relaunch를 다시 실행한 것은 아님 |
| 프로젝트 UI 실제 앱 | 서로 다른 PID 2개, 7시나리오 | 명시 저장, dirty 취소/버리기, 잔류 잠금 새 복사본, native close 취소/저장 후 종료, 손상 원본 보존 복구,390px, 새 PID에서 UI 열기 |
| 기존 작업실 실제 앱 | 17시나리오 | V3 왕복·전역 알림·씬×반복/중지/시드·테마·390px·큐 접기 유지 |
| 프로젝트 IPC Electron | 1/1, 6체크 | 컴파일 preload/sandbox/trusted frame·복사 복구 |
| 인증/전송 Electron | 1/1, 13체크 | defaultSession 오프라인·쿠키 미전송·정상/미분류·부재 MIME/PNG와 리다이렉트 |
| 범위 strict 타입/린트·포맷/구문 | 통과 | schema/main projects/preload/controller/새 controls. 기존 App 전체나 저장소 전체 tsc/lint 통과 주장 아님 |
| 메인/preload/worker·렌더러 빌드·고지 수집 | 통과 | projectWorker.js 별도 산출물. 고지244개·미해결8건 유지, 개발 ts-node를 제품 번들로 추가하지 않음 |

단위 123/123, skip0이다. 각 Electron 검사와 전체 앱의 원격 허용 요청·renderer 오류는0건이다. 기존 전송 하네스만 루프백7건과 defaultSession 거부1건을 사용한다. 프로젝트 UI는 closeCoordinator의 실제 native close→will-quit를 관찰해 기록한 뒤 프로세스가 종료됐으며, 다음 PID에서 보존된 입력을 열었다. 모의 finish IPC만 호출해 종료로 간주한 검사가 아니다.

전체 앱 검사에서 환경 단일 인스턴스 잠금만 모의했다. 프로젝트 파일 저장소·worker·preload·React 조작은 실제 코드다. 원본 appData는 빈 상태로 유지됐고 데이터/키/PNG는 모두 합성이다. 다른 실제 NovelAI 호출은0회이며 기존 성공 실측/정확한 MIME 미확인 상태를 변경하지 않는다.

## 저장 성능 측정

120개 이미지 기록에 같은 합성 2 MiB PNG를 참조시켜 논리 합계 약240 MiB를 구성했다. 물리 PNG는 **1파일**이므로 120개의 서로 다른 디스크 파일을 읽는 벤치마크가 아니다. 일반 저장의 PNG open 횟수는0이며, 측정 시간은 JSON/performance 필드에 둔다. worker open은 120회 참조 무결성 검사와 worker 초기화 시간을 포함하고 호출자 타이머가 그동안 계속 실행됨을 확인했다.

이 수치는 해당 Linux/캐시/CPU 조건의 관찰값이며 다른 디스크·Windows의 지연 보장이 아니다. Claude의 별도 SHA 측정과 직접적인 전후 속도 비율로 비교하지 않는다. 보장하는 회귀는 “기존 PNG를 save 때 다시 읽지 않음”과 “운영 I/O가 worker에서 실행됨”이다. 메인 전송 해석기의 기존 CRC 계산까지 worker로 옮긴 것은 아니다.

## 재현·한계

호스트 Node22.4.1/Linux x64, Electron26.6.10/내장 Node18.16.1. Xorg dummy의 loopback TCP display와 cookie 인증을 사용했다. npm11.19.1은 Node22.4.1 비호환 경고가 있으므로 권장 설치 조합으로 제시하지 않는다. 새 의존성 설치/업그레이드는 하지 않았다.

```sh
npm run test:project
npm run test:project-ui
npm run test:nai-main
npm run test:nai-response
npm run test:offline
npm run test:workspace
npm run test:nai-contract
npm run test:network-mode
npm run build
# Linux X11
npm run smoke:project-ui
npm run smoke:workspace
npm run test:project:electron
npm run test:nai-main:electron
```

이 환경의 단위는 해당 파일들을 node --test 한 실행으로 묶었고, main/renderer 빌드 후 마지막 렌더러 변경을 다시 빌드·고지 수집했다. X11 검사는 순서대로 실행했다. 1363×1023과390×844 화면을 캡처해 새 조작부/기존 캔버스/가로 넘침을 확인했다. worker 실패/큐 한도는 별도 Node 단위 검사이며 실제 Electron worker에서는 UI 저장·열기·복구를 확인했다.

미실행: Windows/macOS·파일 ACL/rename, ASAR 패키지 worker·새 패키징, 실제 온라인/오프라인 모드 재시작의 신규 프로젝트 UI 결합, 전체 dev 서버 재기동, macOS 동일 프로세스 재활성화(상태 reset은 단위 검사), 전원 차단, renderer 무응답 강제 종료, 실제 모델/PNG 화면·영속 큐 연결. PID만으로 잠금 해제는 구현하지 않았고 한도/잠금의 복사 경로를 택했다. renderer가 응답하지 않으면 종료를 자동 승인하는 타이머도 추가하지 않는다.
