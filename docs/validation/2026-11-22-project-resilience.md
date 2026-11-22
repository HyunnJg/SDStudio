# 프로젝트 비정상 종료·실제 패키지 검증 — 2026-11-22

기준 PR19 병합 `57e1a277af4aa2c6dd764221cc094b8fbe0e6142`. 구현 `3d7b6e3f07f7f597ed27850b48065c57edca69ab`, tree `be53156ee8e076c2e466a4f7df02dbdc027d5833`. [정제 결과 JSON](2026-11-22-project-resilience.json), 결정 D-040.

## 확인 결과

| 검사 | 결과 | 범위 |
| --- | --- | --- |
| 프로젝트 단위 | 27/27 | core13, controller6, service/close8. 동기 Worker 생성 실패·외부 cwd·수동 재시작의 쓰기 미재전송·미저장 유지·중복/오래된 native 결정 거부 |
| 관련 회귀 합계 | 127/127, skip0 | 위27 + NAI main36, response19, offline11, workspace14, contract10, network mode10 |
| 범위 strict 타입·린트/포맷·구문 | 통과 | 수정 schema/service/close/IPC/preload/controller/controls 및 하네스. 전체 App/main 스타일 일괄 변경 없음 |
| main/preload/worker·renderer 빌드 | 통과 | 번들 고지244, 원문 누락8 유지. ts-node가 제품 번들에 추가되지 않음 |
| 실제 Linux 디렉터리 패키지 | 전후 모두 통과 | Electron26.6.10, app.isPackaged=true. 기존 native 의존성 재사용(npmRebuild=false), 서명/업로드 없음 |
| PR19 기준 패키지 프로젝트 UI | 6체크 + 실제 종료 | 저장·열기/버리기·남은 잠금 복사·손상 이력 복구·390px·닫기. worker ASAR 내부에서 실행됨 |
| 최종 패키지 프로젝트 UI | 같은6체크 + 실제 종료 | 원본 appData 불변, 실행 전후 ASAR 해시 동일 |
| 최종 패키지 worker 실패 | 3체크 + 실제 종료 | 실제 worker terminate → 닫기 저장 실패/입력 유지 → 수동 재시작(파일 무변경) → 별도 새 저장 성공 |
| 최종 패키지 renderer crash | 2체크 + 실제 종료 | forcefullyCrashRenderer → native 취소(파일 유지) → 명시적 버리기 종료 |
| 최종 패키지 unresponsive | 2체크 + 실제 종료 | 무응답 이벤트를 주입. native 기다리기 뒤 명시적 버리기 종료 |
| 비패키지 UI 재개 | 2PID·7체크 + native 종료 | UI 저장/복구/취소/재시작 후 읽기 회귀 |
| preload/core IPC Electron | 1테스트·6체크 | 신뢰 프레임/로컬 저장/복구·오류·원본 불변 |
| 실제 패키지 고지 검사 | 통과 | 원문250사본, bundle143 대응, runtime112. 원문 누락8은 그대로; 배포 허용 완료 아님 |

모든 전체 UI 실행은 원격 요청0·renderer console 오류0. 의도적 crash의 Chromium FATAL 메시지는 강제 종료 주입 결과로 별도 취급했다. 원본/포크 개인 프로필·토큰·PNG는 사용하지 않았다. 계정 API 요청0.

## ASAR 판단

PR19 기준과 최종 산출물 모두 `dist/main/projectWorker.js`가 app.asar 논리 파일이며 unpack 사본은 없다. worker 크기12,121B, SHA256 `9d5295943657e63b5c579b6b221a4fe65b996ca99ae468ff4130fddcf9aede97`로 같고 실제 프로젝트 저장/복구가 통과했다. 따라서 ASAR 때문에 필연적으로 실패한다는 가설은 이 환경에서 재현되지 않았으며 asarUnpack/entry 경로를 변경하지 않았다. 각 패키지의 실행 전후 archive 해시 일치는 JSON packageContext에 기록했다. 기준과 최종 ASAR은 코드 변경 때문에 서로 다른 해시다.

## 재현

Node22.4.1, Electron26.6.10(Node18.16.1), Linux x64. 설치된 npm11.19.1은 Node22.4.1 미지원 경고를 냈으며 권장 조합이 아니다. 테스트·타입·린트는 해당 Node로 직접 실행했다. 깨끗한 npm ci 또는 Windows 설치 성공을 새로 주장하지 않는다. 전체 저장소 tsc는 재실행하지 않았고 기존 TS2688을 해결한 작업도 아니다.

```sh
npm run build
npx electron-builder --linux --dir --publish never \
  --config.directories.output=/absolute/test-output \
  --config.npmRebuild=false --config.electronDist=node_modules/electron/dist
# Linux X11 디스플레이에서 순서대로 실행
npm run smoke:package -- /absolute/test-output/linux-unpacked projects
npm run smoke:package -- /absolute/test-output/linux-unpacked worker
npm run smoke:package -- /absolute/test-output/linux-unpacked crash
npm run smoke:package -- /absolute/test-output/linux-unpacked unresponsive
npm run package:check-notices -- /absolute/test-output/linux-unpacked
npm run smoke:project-ui
npm run test:project:electron
```

패키지 실행은 loopback inspector로 하네스만 주입하며 app.asar/app.isPackaged를 수정하지 않는다. 단일 인스턴스 잠금을 모의했고 native dialog 선택도 모의했으므로 OS의 실제 사용자 클릭/모달 표시 자체를 검증했다고 주장하지 않는다. 무응답은 실제 무한 루프가 아닌 이벤트 주입이다. Xorg dummy는 cookie 인증 TCP loopback으로만 실행했다.

하네스 초기 두 시도는 저장 기능 복구 중 disabled 버튼을 너무 일찍 눌러 timeout으로 실패했다. UI의 operation 종료/버튼 활성화를 기다리도록 검사 순서를 고친 뒤 통과했고 제품 코드 완화를 하지는 않았다.

미실행: Windows/macOS ASAR/ACL/rename, 실제 hang 감지 지연, 전원 차단, clean native 재설치, 전체 dev 서버, 실제 단일 인스턴스 잠금, 실제 온라인 relaunch와 이 UI의 결합, 120개 서로 다른 물리 PNG 벤치마크, 실제 모델/PNG 화면·큐 영속화. 이번 수동 저장 기능 재시작은 앱 재시작이 아니며 실패한 쓰기를 다시 보내거나 잠금을 삭제하지 않는다.
