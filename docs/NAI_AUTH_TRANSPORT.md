# 새 인증·전송 기반 — P0-03b1

2026-11-21. 런타임 기준 `ed384bd522c6519f3cfb5b9e612901028f1ea85a`, 시작 기준 PR #9 병합 `745248896d2bda5ebe3c413520063db3496968af`.

이번 범위는 메인 토큰 보관과 전송 수명이다. 인증 IPC는 실제 main/preload에 연결했다. 전송기는 Electron 통합 검사에서 직접 호출하며 **제품 생성 경로에는 아직 연결하지 않는다**. 토큰 입력 UI, 토큰 유효성 확인, 모델 ID/필수값 바인딩, 새 프로젝트 저장·복구와 실제 생성 성공은 후속 P0-03b2다.

## 토큰 보관

| 선택/상태 | 동작 |
| --- | --- |
| 세션 한정 | 메인의 문자열 참조로 보관. 파일을 쓰지 않고 종료 시 참조 해제. 이전 영구 보관 파일이 있으면 envelope 확인 후 명시적 모드 변경 때 제거해 다음 실행에서 옛 토큰이 돌아오지 않게 함 |
| 영구 보관 | Electron 26 `safeStorage.encryptString` 결과만 `<userData>/auth/novelai-token.v1.json`에 저장. 임시 파일을 0600으로 만들고 rename. 디렉터리 신규 생성 시 0700 |
| 보안 저장 없음 | 영구 보관 거부. Linux는 `basic_text`/`unknown`도 거부하며 평문 대체를 켜지 않음. 세션 한정은 별도로 선택 가능 |
| 상태 조회 | 파일 존재/세션 보관 여부와 OS 보안 저장 가용성만 반환. 토큰 복호화나 네트워크 검증을 하지 않음. `configured`는 인증 성공이 아니라 보관 항목 존재를 뜻함 |
| 구조 손상/미지원 버전 | 읽기 및 영구 교체 거부. 파일을 자동 삭제/승격하지 않음. 사용자가 명시적으로 clear 후 재입력 가능 |
| 복호화 실패 | 원문 예외 대신 `STORE_UNREADABLE`. 기존 암호문을 그대로 유지. 명시적 삭제/재입력으로 복구 |
| 암호화·쓰기 실패 | 새 토큰을 평문으로 쓰지 않고 기존 파일/메모리를 유지. 정리 실패 시 암호화된 임시 파일이 남을 수 있음 |

`TOKEN.txt`, V3 로그인·세션·config.saveLocation은 읽거나 변환하지 않는다. 저장 위치는 saveLocation이 아닌 격리된 Electron userData다. 생성/상태 조회만으로 auth 디렉터리를 만들지 않는다. 토큰 문자열 길이 1..4096 및 ASCII 공백/개행 거부는 로컬 헤더 보호 정책이며 서버 토큰 규격이나 유효성 판정이 아니다. `pst-` 접두사를 추측하여 붙이지 않고 입력 전체를 보관한다.

JS 문자열의 확실한 메모리 영점화는 보장하지 않는다. OS 보안 저장은 플랫폼별 보호 범위가 다르며 같은 사용자 권한의 모든 프로세스로부터 격리한다는 주장이 아니다. Windows/macOS 및 실제 Linux 키링의 암호화 저장은 미실측이다.

## IPC 경계

`window.electron.naiAuth`는 `status()`, `setToken(token, remember)`, `check()`, `clear()`를 제공한다. check는 명시적인 로컬 읽기 확인이며 상태/locallyReadable만 반환한다. 토큰 입력은 일시적으로 호출자의 메모리에 있지만 **메인에서 토큰을 돌려받는 IPC는 없다**. 반환은 `{ok, status}` 또는 `{ok:false, code}`로 제한한다. 공급자/파일 예외 원문을 렌더러나 로그에 보내지 않는다.

현재 mainWindow의 최상위 프레임과 최초 승인한 문서의 protocol/host/path를 함께 검사한다. 다른 창·자식 프레임·외부 탐색 문서는 거부한다. 모든 동작은 오프라인이면 저장소 접근 전에 거부한다. 기존 V3의 파일 IPC/로그인 경로를 이 새 경계로 전환한 것은 아니다. P0-03b2 인증 화면이 이 IPC를 호출한다. 상단의 b1 당시 범위와 후속 구현을 구분한다.

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


## P0-03b2 인증 화면·포크 식별 추가

런타임 `e64d205ad06c5e82218f7957a62894c782effe44`. [D-026/027](DECISIONS.md)에 따라 userData 기본 경로는 appData/SDStudio-HyunnJg, 내부 앱 이름도 SDStudio-HyunnJg이며 ID는 io.github.hyunnjg.sdstudio다. 원본 및 포크 초기 개발 프로필의 토큰을 자동 이관하지 않는다. 기본 포크 프로필도 기존 격리/기본 오프라인/saveLocation 무시 정책을 사용한다.

두 데스크톱 화면의 API 토큰 버튼은 동일한 모달을 연다. 기본 세션 한정, 안전한 키링 불가 시 영구 보관 비활성, 앞뒤 공백 정리 안내, 네트워크 없는 명시적 읽기 검사, 삭제 확인과 손상/미지원 파일 복구 안내를 제공한다. 보관/로컬 읽기를 서버 인증 성공으로 표시하지 않는다. 입력은 부모 App/세션/기록에 두지 않으며 성공·닫기 시 비운다. 실패 시 현재 패널에만 유지한다.

인증 입력 UI와 local check는 완료됐고 실제 모델 전송·새 프로젝트 저장은 여전히 미연결이다. [화면 및 실행 근거](validation/2026-11-21-auth-settings.md).


## 연결 모드 설정과 재시작

D-028은 일반 포크의 다음 시작 모드를 로컬 파일로 저장한다. network-mode-* IPC만 오프라인에서도 사용할 수 있으며 auth IPC의 거부 정책은 바꾸지 않는다. 저장 뒤에도 현재 runtime은 고정되고 실제 재시작 뒤에만 적용된다. 개발/목업/환경 지정 강제값은 UI보다 우선한다. 재시작 전에 V3 저장과 작업 유무를 확인하며, 세션 한정 토큰은 새 프로세스에 이관하지 않는다. [실기 검증](validation/2026-11-21-network-mode.md). 모델 ID·전송 바인딩·새 프로젝트 저장은 여전히 미완료다.


## 메인 이미지 응답 경계 (D-030)

내부 sendImage는 기존 send 뒤에 제한된 ZIP→PNG 검증을 연결한다. 전송과 해제는 하나의 전체 기한/AbortSignal을 공유한다. ZIP 64 MiB·해제 PNG 32 MiB·16,777,216 픽셀은 로컬 한도다. 단일 PNG의 STORE/DEFLATE·일반/스트리밍 descriptor를 다루고, ZIP/PNG CRC와 구조를 확인해 원본 PNG 바이트를 반환한다. ZIP64·암호화·다중 엔트리/부가 파일·unsafe 경로 등은 거부한다. 좁은 응답 형식의 실제 서버 호환은 아직 미확인이다.

응답 이후의 실패는 mayHaveReachedServer=true를 유지한다. 2xx MIME 거부는 RESPONSE_FORMAT, 압축/PNG 오류는 INVALID_IMAGE_RESPONSE, 자원 한도는 RESPONSE_TOO_LARGE다. 자동 재시도와 원문 오류 보관은 없다. 이 메인 경로는 생성 IPC/UI에 아직 연결하지 않았다. [테스트·한계](validation/2026-11-21-image-response.md), [최소 실호출 계획](NAI_LIVE_VALIDATION.md).

기존 V3 이메일/비밀번호 로그인은 TOKEN.txt 평문 저장을 유지하는 별도 경로다. 환경설정에 이를 명시하고 상단의 V3 상태가 새 API 토큰 보관/서버 인증을 나타내지 않도록 바꿨다. 새 토큰 보안 저장을 앱 전체 인증 방식에 적용했다고 해석하지 않는다.


## 내부 사유와 로컬 재검사 (D-031)

imageResponseReason은 main 전용 고정 코드이며 공개 오류 message/code·auth IPC는 그대로다. 사유는 비열거 읽기 전용 속성이므로 JSON에 자동 추가되지 않고 검증 도구가 명시적으로 꺼낸다. 사용자/서버 내용이 들어가는 자유 텍스트 사유는 허용하지 않는다. sendImage의 오류 재전파는 사유와 mayHaveReachedServer=true를 함께 보존한다.

nai:inspect-response는 명시적으로 고른 일반 파일 하나만 제한해 읽고, 네트워크·토큰 조회·추출·쓰기 없이 같은 응답 검사를 실행한다. 원본 보관은 기본 꺼짐인 후속 계획이며 현재 자동 저장하지 않는다. STORE PNG는 전체 ZIP과 분리한 버퍼로 반환한다. [검증](validation/2026-11-21-response-diagnostics.md).
