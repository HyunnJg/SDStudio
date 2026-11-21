# 응답 실패의 내부 사유·로컬 재검사

2026-11-21 (Asia/Seoul). 시작 기준 `a226b63`(PR #13 병합), 구현 `2a1c78f070736bf92726f659368e78d9d113c74b` / 트리 `f360ad90e80bf04f253b0554702b5645ff0bb4ff`.

D-031과 [PR #13 의견 처리](../reviews/2026-11-21-pr13-followup.md)에 따라 실패 위치를 고정 사유로 구분하고 같은 응답의 로컬 재검사를 추가했다. 모델 바인딩/생성 IPC·새 프로젝트 저장·실제 계정 호출은 여전히 없다. 사용자 실험 재량 위임과 보수적 최초 계획은 [별도 문서](../NAI_LIVE_VALIDATION.md)에 기록하되 계정 식별값은 남기지 않았다.

## 경계

- 코드/message는 그대로 두고 main 전용 imageResponseReason만 추가한다. ZIP EOCD/엔트리 수/헤더·이름/descriptor/해제/CRC, PNG 청크/CRC/종단 및 한도·취소/기한을 구분한다. 자유 텍스트를 받지 않으며 목록은 runtime freeze, 속성은 읽기 전용·비열거다.
- sendImage의 응답 후 오류 재전파가 내부 사유와 mayHaveReachedServer=true를 유지한다. 사용자 화면/기존 auth IPC에 사유를 추가하지 않고 자동 로그도 남기지 않는다. 사유가 없던 요청 전 오류의 의미는 바꾸지 않는다.
- STORE 반환값은 PNG만 담긴 독립 버퍼로 복사한다. DEFLATE는 기존 방식이며 원본 PNG 바이트·크기 제한·CRC 검사는 유지한다.
- 로컬 재검사는 명시적으로 고른 일반 파일 하나만 읽는다. 크기 확인 뒤 고정 길이만 읽고, 파일이 커지거나 잘렸으면 거부한다. 파일 내용/이름·경로를 출력하지 않고 상태/코드/사유/바이트 수만 출력한다. API·토큰/프로필 검색·파일 추출·쓰기·업로드는 없다. 과거 서버 처리나 과금 여부를 판정하는 기능도 아니다.
- 원본 응답 자동 저장은 구현하지 않았다. 실패 응답 보관을 나중에 선택할 때 적용할 비공개 테스트 프로필/한도·권한·공유 제외 기준만 계획에 추가했다.

## 실행 결과

호스트 Node 22.4.1, 실제 Electron 26.6.10/내장 Node 18.16.1, Linux x64. 기존 설치를 재사용했다. [요약](2026-11-21-response-diagnostics-summary.json), [실기·CLI 예제](2026-11-21-response-diagnostics-runtime.json).

| 검사 | 결과 |
| --- | --- |
| test:nai-response | **19/19**: 응답/진단 16건 + CLI 3건. 기존 압축·CRC·한도·취소/기한 회귀, 주요 거부 지점의 정확한 사유, 재전파·민감 합성 문자열 배제, STORE 버퍼, 허용 목록/비열거, 명시적 로컬 파일/크기·파일 오류/불변 |
| 기존 인증·오프라인 | test:nai-main 19/19, test:auth-ui 3/3, test:offline 11/11 통과 |
| 범위 엄격 타입·린트 | main의 errors/responseReasons/imageResponse/transport 통과. 전체 저장소 tsc의 기존 TS2688 해결을 주장하지 않음 |
| production 빌드 | main/preload/renderer 및 고지 생성 통과. 기존 webpack transpileOnly 사용. 244 고지 레코드/미해결 원문 8건 유지 |
| 실제 Electron | 1테스트·10체크 통과. net.request 루프백 PNG 원본 일치, 잘못된 응답의 zip-eocd 사유와 서버 처리 가능성 보존, 기존 토큰/IPC·오프라인·쿠키·리다이렉트 경계 유지 |
| 로컬 도구 예제 | 합성 정상 ZIP은 원본/PNG 바이트 수, IEND 뒤 데이터가 있는 합성 ZIP은 INVALID_IMAGE_RESPONSE/png-trailing. 파일이나 본문을 출력하지 않음 |

CLI 테스트는 Module load guard로 http/https/net/tls/electron 및 tokenStore import와 fetch를 금지한 별도 프로세스에서도 통과했다. 정상/불량 입력 모두 파일 내용·mtime/폴더 목록의 불변과 내용 없는 결과를 검사했다. 사전 크기 한도는 sparse 64 MiB 초과 파일로 확인했다.

## 재현

```sh
npm run test:nai-response
npm run test:nai-main
npm run test:auth-ui
npm run test:offline
npm run build
npm run test:nai-main:electron
npm run nai:inspect-response -- /absolute/response.zip
```

Electron 테스트는 X11이 필요하고 이 환경은 Xorg dummy/TCP를 사용했다. 이 검사는 하네스가 운영 소스 모듈을 불러 수행했으며 실제 계정 호출이 아니다. 새 패키징/패키지 UI 스모크·Windows/macOS·실제 키링 성공·새 npm ci·CRC 성능 측정은 이번에 반복하지 않았다. UI를 바꾼 작업이 아니며 관련 패키지 UI 기준선은 PR #13 기록에 있다.

동기 CRC 구간은 기존대로다. 그 구간에서 취소 콜백/타이머를 즉시 실행할 수 있게 개선했다고 주장하지 않는다. 실제 대기열 연결 시 이벤트 루프 지연을 측정한다. 모델 요청 바인딩과 안전한 실제 토큰 입력·비용 확인 후 첫 실호출을 별도로 수행한다. 현재 실제 API 생성/과금은 0이다.
