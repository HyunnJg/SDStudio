# 운영 이미지 수신·MIME 진단 검증 — 2026-11-22

- 기준: PR #16 병합 `c87380a3db6fd83cc7150320b71a75087df1cfb4`.
- 런타임: `f364bb9200efa9411a451460f3a7f1ebead065b8`, tree `9e7eda5b383dff7d43afd2937ec286f6deba3e34`.
- 범위: D-036, 메인 sendImage 기본 MIME 수신·정제된 메인 진단과 연구 결과 저장·active 해제. 실제 모델/생성 IPC·UI 대기열·신규 프로젝트 저장은 미연결.
- 데이터: 합성 토큰·가짜 MIME·로컬 서버 응답만 사용. 실제 계정 호출 0회. 사용자의 기존 성공 PNG/ZIP·토큰·잔액·계정 식별값은 받거나 기록하지 않았다.
- [상세 결과 JSON](2026-11-22-production-image-transport.json).

## 결과

| 검사 | 결과 | 확인한 범위 |
| --- | --- | --- |
| test:nai-main | 34/34 | 인증, 전송, 새 MIME 정제 3건 포함 |
| test:nai-live | 12/12 | 후처리 예외의 active 해제·재전송 거부·불완전 잔액 복구, 저장 경계 MIME 재검사 |
| test:nai-response | 19/19 | 엄격 ZIP/PNG·로컬 재검사. sendImage 테스트는 내부 send 대체 대신 실제 요청 주입 경계를 사용 |
| test:offline | 11/11 | 기존 오프라인 경계 유지 |
| 메인 Electron | 1/1, 13체크 | 기본 운영 옵션의 미분류/부재 MIME ZIP, HTML·가짜 ZIP 거부, 동일 defaultSession 차단·쿠키 미전송·리다이렉트 거부 |
| 연구 창 Electron | 8/8, 50체크 | 기존 7경로 + 헤더 부재. 전체 응답·원본 PNG·로컬 재검사·토큰 잠금·재전송 거부 |
| 독립 도구 | 3/3 | 루트 node_modules 없는 임시 체크아웃의 실제 창/강제 오프라인·추가 인자 검증 |
| 범위 엄격 타입/린트 | 통과 | 변경된 main/nai 4모듈, CJS 구문·Prettier도 통과 |
| 메인/렌더러 빌드·고지 수집 | 통과 | 기존 미해결 고지 8건은 그대로이며 허용 판정으로 바꾸지 않음 |

단위 검사는 한 실행에서 76/76, 메인·연구 Electron은 9/9, 독립 도구는 3/3(이 중 실제 Electron 1건)이며 모두 skip 0이다. 연구 창 전체의 원격 요청·렌더러 오류 0건, 루프백 요청 6건이다. 메인 하네스는 루프백 7건, 오프라인 defaultSession 거부 1건, 허용 원격 요청 0건이다.

미분류 MIME 테스트 값은 `application/x-sdstudio-test`이며 실제 서버 MIME이 아니다. 연구 결과의 mediaTypeState=present/mediaType과 absent를 확인하고 헤더 매개변수가 저장되지 않음을 검사했다. 기존 두 사용자 실측의 정확한 MIME은 여전히 미확인이다. 추가 유료 호출로 이를 알아내려 하지 않았다.

## 실행 환경·명령

호스트 Node 22.4.1, Linux x64, Electron 26.6.10/내장 Node 18.16.1. 임시 Xorg dummy의 TCP loopback display와 cookie 인증을 사용했다. npm 11.19.1은 Node 22.4.1과 비호환 경고가 있었으므로 새 권장 npm 조합으로 제시하지 않는다. 단위/타입/린트는 Node로 직접 실행했고 빌드의 npm 자식 명령은 경고 후 성공했다. 새로운 npm ci는 수행하지 않았다.

```sh
# 저장소 기준 Node 22.4.1 선택 후
npm run test:nai-main
npm run test:nai-live
npm run test:nai-response
npm run test:offline
# Linux X11 display 준비 후
npm run test:nai-main:electron
npm run test:nai-live:electron
node --test tools/nai-validation/test.cjs
npm run build
```

위는 재현용 저장소 명령이며 이 환경에서는 동일한 node --test 인자를 묶어 단위 76건을 실행했다. 빌드는 build:main/build:renderer 병렬 성공 후 collect-bundle-notices.cjs를 실행했다. main/preload/renderer의 소스 빌드는 패키지 재생성을 뜻하지 않는다.

미실행: Windows/macOS, Windows 루트 npm ci·VS2026 네이티브 도구 체인, 새 패키징/실제 키링·추가 계정 API 호출·제품 생성 연결·신규 프로젝트 저장. 전체 tsc는 이전 TS2688 한계가 있고 이번에는 범위 검사만 실행했다. 테스트 중 두 기존 테스트가 public send를 가로채던 문제는 요청 주입으로 바꿨고, 잘못된 가짜 ZIP fixture는 ZIP 시작부를 가진 불량 본문으로 수정해 최종 결과를 다시 검증했다.
