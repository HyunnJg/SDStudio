# 새 인증·전송 기반 — P0-03b1

2026-11-21. 런타임 기준 `ed384bd522c6519f3cfb5b9e612901028f1ea85a`, 시작 기준 PR #9 병합 `745248896d2bda5ebe3c413520063db3496968af`.

이번 범위는 메인 토큰 보관과 전송 수명이다. 인증 IPC는 실제 main/preload에 연결했다. 전송기는 Electron 통합 검사에서 직접 호출하며 **제품 생성 경로에는 아직 연결하지 않는다**. 토큰 입력 UI, 토큰 유효성 확인, 모델 ID/필수값 바인딩, 새 프로젝트 저장·복구와 실제 생성 성공은 후속 P0-03b2다.

## 토큰 보관

| 선택/상태 | 동작 |
| --- | --- |
| 세션 한정 | 메인의 문자열 참조로 보관. 파일을 쓰지 않고 종료 시 참조 해제. 이전 영구 보관 파일이 있으면 명시적 모드 변경 때 제거해 다음 실행에서 옛 토큰이 돌아오지 않게 함 |
| 영구 보관 | Electron 26 `safeStorage.encryptString` 결과만 `<userData>/auth/novelai-token.v1.json`에 저장. 임시 파일을 0600으로 만들고 rename. 디렉터리 신규 생성 시 0700 |
| 보안 저장 없음 | 영구 보관 거부. Linux는 `basic_text`/`unknown`도 거부하며 평문 대체를 켜지 않음. 세션 한정은 별도로 선택 가능 |
| 상태 조회 | 파일 존재/세션 보관 여부와 OS 보안 저장 가용성만 반환. 토큰 복호화나 네트워크 검증을 하지 않음. `configured`는 인증 성공이 아니라 보관 항목 존재를 뜻함 |
| 구조 손상/미지원 버전 | 읽기 및 영구 교체 거부. 파일을 자동 삭제/승격하지 않음. 사용자가 명시적으로 clear 후 재입력 가능 |
| 복호화 실패 | 원문 예외 대신 `STORE_UNREADABLE`. 기존 암호문을 그대로 유지. 명시적 삭제/재입력으로 복구 |
| 암호화·쓰기 실패 | 새 토큰을 평문으로 쓰지 않고 기존 파일/메모리를 유지. 정리 실패 시 암호화된 임시 파일이 남을 수 있음 |

`TOKEN.txt`, V3 로그인·세션·config.saveLocation은 읽거나 변환하지 않는다. 저장 위치는 saveLocation이 아닌 격리된 Electron userData다. 생성/상태 조회만으로 auth 디렉터리를 만들지 않는다. 토큰 문자열 길이 1..4096 및 ASCII 공백/개행 거부는 로컬 헤더 보호 정책이며 서버 토큰 규격이나 유효성 판정이 아니다. `pst-` 접두사를 추측하여 붙이지 않고 입력 전체를 보관한다.

JS 문자열의 확실한 메모리 영점화는 보장하지 않는다. OS 보안 저장은 플랫폼별 보호 범위가 다르며 같은 사용자 권한의 모든 프로세스로부터 격리한다는 주장이 아니다. Windows/macOS 및 실제 Linux 키링의 암호화 저장은 미실측이다.

## IPC 경계

`window.electron.naiAuth`는 `status()`, `setToken(token, remember)`, `clear()`만 제공한다. 토큰 입력은 일시적으로 호출자의 메모리에 있지만 **메인에서 토큰을 돌려받는 IPC는 없다**. 반환은 `{ok, status}` 또는 `{ok:false, code}`로 제한한다. 공급자/파일 예외 원문을 렌더러나 로그에 보내지 않는다.

현재 mainWindow의 최상위 프레임과 최초 승인한 문서의 protocol/host/path를 함께 검사한다. 다른 창·자식 프레임·외부 탐색 문서는 거부한다. 세 동작 모두 오프라인이면 저장소 접근 전에 거부한다. 기존 V3의 파일 IPC/로그인 경로를 이 새 경계로 전환한 것은 아니다. UI는 아직 이 IPC를 호출하지 않는다.

## 전송 경계

- `createNaiTransport()`는 `net.request`를 **defaultSession에 명시적으로 연결**한다. main.ts가 설치하는 동일한 `installOfflineRequestGuard`의 적용을 Electron 26.6.10에서 확인했다. 다른 partition이나 Node fetch를 추가하지 않는다.
- 생산 코드의 목적지는 `POST https://image.novelai.net/ai/generate-image`로 고정한다. 임의 URL을 받는 생성 IPC는 없다. `Authorization: Bearer <입력 전체>`를 메인에서 설정하고 ZIP 응답을 요청한다. 세션 쿠키/기본 자격증명은 사용하지 않는다.
- 오프라인/이미 취소됨을 **토큰 조회 전** 거부한다. 조회 대기 뒤와 실제 write 직전에 다시 확인한다. 요청 본문은 await 전 복사한다.
- `AbortSignal`과 단조 시계 기반 전체 기한을 사용한다. 기본 90초, 허용 최대 180초는 로컬 정책이다. 동기 키링 호출이 이벤트 루프를 막아 타이머가 늦어져도 write 직전에 기한을 확인한다. OS 대화상자 자체를 강제 중단한다는 뜻은 아니다.
- write 전에 취소되면 전송하지 않는다. write 이후 취소/실패는 `mayHaveReachedServer=true`로 기록해 처리·과금 여부가 불명확함을 보존한다. 이 값이 true라고 과금이 확인된 것은 아니다. 자동 재시도는 없다.
- 리다이렉트를 따라가지 않는다. 비 2xx·비 ZIP 계열 content-type, 오류/응답 중단과 64 MiB 초과 응답을 거부한다. 입력 본문은 최대 4 MiB. 응답은 재인코딩 없이 Uint8Array로 반환한다. 서버 오류 본문/토큰/프롬프트를 예외에 보관하지 않는다.
- 이 환경에서는 요청의 writable `finish → close`가 HTTP 응답보다 먼저 발생했다. request close만으로 실패 처리하면 정상 요청도 중단돼 제거했다. 응답 end/error/aborted 및 기한으로 완료를 판정하고 회귀 테스트를 남겼다.

64 MiB는 압축 응답 한도다. ZIP 해제 크기 제한·모델별 본문 검증·실제 PNG 기록 및 저장 호환을 완료한 것으로 표시하지 않는다. 예약 큐가 취소 신호를 보내는 연결 및 전송 전 취소 작업의 pending 복구도 P0-03b2/P1-02에 남는다.

## 근거와 검증

- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage), [ClientRequest](https://www.electronjs.org/docs/latest/api/client-request), [net](https://www.electronjs.org/docs/latest/api/net). 최신 문서의 새 API를 그대로 적용하지 않고 설치된 **Electron 26.6.10 electron.d.ts**의 동기 API·옵션을 대조했다.
- [공식 Image API 스키마](https://image.novelai.net/docs/doc.json)를 2026-11-21 다시 열어 통합용 Persistent API token 요구와 Bearer 사용 설명, 생성 엔드포인트를 확인했다. 이 공개 자료 확인은 인증/생성 엔드포인트 호출이 아니다.
- [실행 기록](validation/2026-11-21-main-auth.md), [실제 Electron 보고서](validation/2026-11-21-main-auth-electron.json).

테스트는 합성 토큰/암호화 공급자와 루프백 서버만 사용한다. Electron 테스트의 원격 URL은 공유 오프라인 훅에서 취소하며 추가로 닫힌 루프백 프록시를 둔다. 정상 응답/307 검증 때만 **하네스 내부**에서 URL을 로컬 서버로 바꾼다. 서버는 합성 쿠키를 미리 저장한 세션에서도 Cookie가 오지 않는지 검사한다. 운영 코드에 목적지 변경 옵션을 넣지 않는다.
