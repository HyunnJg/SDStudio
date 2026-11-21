# 1회 실험 창·비공개 응답 보관 — 합성 검증

2026-11-21 (Asia/Seoul). 기준 PR #14 병합 742048f505f03b4cbfe95f96efe981f7d5946f5d. 구현 bd0a4c4f146450b33342dc5874e9c9eb32c3d8c2, 트리 8042ccbff4b53955467cce806de385023bb671e0. [요약 JSON](2026-11-21-live-validation-summary.json), [실제 Electron의 합성 결과](2026-11-21-live-validation-runtime.json).

D-032/[PR #14 처리](../reviews/2026-11-21-pr14-followup.md)에 따라 실제 실행 가능한 별도 연구 창을 준비했다. **실제 NovelAI 호출·자격증명 사용·지출은 0**이다. 테스트는 가짜 토큰과 합성 loopback 서버만 사용했다. 연구 후보의 서버 호환을 확인한 것이 아니다.

| 검사 | 결과 |
| --- | --- |
| test:nai-live | 8/8. 수동 비용/해시/보관 선택 선행 거부, 전송 1회 선점·동시 실행/재개 거부, 실패 ZIP의 0600 저장/같은 사유 재검사, token/offline/선취소, 정상 PNG·후잔액 1회 기록, 무응답/HTTP 오류 사생활, 링크/권한·기존 파일 보존, 운영 renderer/preload 내부 사유 참조 금지 |
| test:nai-main | 23/23. 기존 19건 + 선택 HTTP 원문 capture, 64 KiB prefix 한도/중단, capture 실패 종료, observer 사본 변조가 반환 바이트에 영향 없음 |
| 기존 회귀 | test:nai-response 19/19, test:offline 11/11, test:auth-ui 3/3 |
| 범위 타입·린트 | liveValidation/transport 등 새 메인 모듈 엄격 타입과 린트 통과. 전체 저장소 tsc의 기존 TS2688 해결 주장은 하지 않음 |
| production 빌드 | main/preload/renderer·고지 생성 통과. transpileOnly 사용. 기존 고지 244 레코드·원문 8건 미해결 유지 |
| 연구 Electron 창 | 5테스트/33체크: 정상 PNG·손상 ZIP·HTTP 400·응답 전 중지·강제 offline. 앞 네 경로 각각 loopback 1건, offline은 0건 |
| 기존 메인 Electron | 1테스트/10체크. compiled preload 인증/오프라인, 실제 defaultSession 차단, 쿠키 없음, PNG 보존, 내부 사유/서버 처리 가능성, redirect 거부 |

호스트 Node 22.4.1/npm 10.8.1, Linux x64, 실제 Electron 26.6.10/내장 Node 18.16.1. 기존 설치와 네이티브 산출물을 재사용했다. 새 npm ci·패키징·Windows/macOS·실제 OS 키링 보관 성공·사용자 계정은 이번 범위에서 실행하지 않았다. 연구 창은 소스/ts-node 실행이며 app.isPackaged=true인 배포본 검증으로 표시하지 않는다.

## 실제 창에서 확인한 흐름

토큰·비용 확인 전 전송 없음 → 표시 비용 11 거부(시도 미소비) → 합성 키 입력/DOM 비우기/토큰 파일 없음 → 다른 창 IPC 거부 → 수동 증거 선택 후 1건 전송 → 파일 보관/해석 → 키 메모리 lock → 2회 요청 거부 → 후잔액 기록. 390px에서 가로 넘침도 없다. 강제 offline은 token/save/run UI와 IPC를 모두 막고 attempt 파일도 만들지 않는다.

정상 응답은 DEFLATE ZIP이며 result.png가 합성 원본 PNG와 바이트 동일하다. 손상 ZIP은 먼저 response.zip에 저장되고 INVALID_IMAGE_RESPONSE/zip-eocd가 발생한다. **같은 보관 파일을 CLI로 다시 읽어 같은 사유를 확인했고 두 번째 HTTP 요청은 없었다.** HTTP 400의 원문은 비공개 파일에만 있고 result.json에는 설명 본문이 없다. 취소는 서버 도착 뒤 CANCELLED/mayHaveReachedServer=true이고 responseCaptured=false·빈 예약 파일로 완전 보관을 주장하지 않는다.

Linux에서 원문/attempt/result 파일 0600, 원본 가짜 appData의 폴더 생성 없음, 렌더러 오류 없음도 확인했다. 테스트에서 운영 guard의 ready 이전 적용 요구를 유지했다. 초기 실기 하네스가 비동기 서버 준비를 먼저 하여 ready 이후 격리를 시도했을 때 거부됐고, 하네스만 동기 진입 후 whenReady 안에서 서버를 준비하도록 고쳤다. 운영 ready 검사를 완화하지 않았다.

## 재현

```sh
npm run test:nai-live
npm run test:nai-main
npm run test:nai-response
npm run test:offline
npm run test:auth-ui
npm run build
npm run test:nai-live:electron
npm run test:nai-main:electron
```

Electron은 Linux X11이 필요하다. 이 실행 환경은 Xorg dummy/TCP display를 사용했다. root 컨테이너의 추가 Electron 인자는 기존 SDSTUDIO_TEST_ELECTRON_ARGS를 테스트에만 전달할 수 있다. 실제 계정 도구에는 목적지 변경/키 인자/자동 재시도 옵션이 없다.

실호출의 미해결 조건은 [별도 실행 계획](../NAI_LIVE_VALIDATION.md)에 있다. 사용자가 자신의 PC에서 토큰을 직접 입력하고 웹 비용을 확인해야 한다. 앱이 사용자 PC의 키를 개발 환경에 전송하거나 Account ID로 인증하지 않는다. 새 프로젝트·V3 변환·작업실 대기열 실연결은 계속 후속 작업이다.
