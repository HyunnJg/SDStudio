# 비동기 토큰 보관 — P0-01e

2026-11-24. PR30은 main `c6ceb01`로 병합했다. P0-01e-b는 그 커밋에서 운영 store·인증 IPC·연구 창 ready를 비동기로 전환한다. Electron은 **45.4.1 고정**이며46 업그레이드는 별도 검토다. 토큰 파일의 경로와 v1 envelope는 유지한다.

## 운영 계약

- `status/read/set/clear`는 Promise다. IPC·전송 token supplier·연구 창은 결과를 기다린다. 상태 조회는 복호화나 네트워크 인증을 하지 않는다. `lock`은 즉시 진행 중 작업을 무효화한다.
- 유효한 교체·삭제·lock은 세대를 올린다. OS 가용성/암호화/복호화가 늦게 완료되면 세대를 확인해 `CANCELLED`로 버린다. 삭제는 멈춘 OS 작업을 기다리지 않으며, 이전 토큰이 파일이나 반환값으로 되살아나지 않는다. 읽기는 현재 진행 중인 저장을 기다린다.
- 영구 교체는 OS await 전후의 기존 envelope 바이트를 대조한다. 외부 변경·손상·상위 버전 파일은 덮어쓰지 않는다. 기존 파일/메모리는 암호화·쓰기 실패 때 보존한다. 명시적 clear만 삭제를 허용한다.
- `decryptStringAsync`의 `shouldReEncrypt`는 힌트만 읽는다. read가 기존 파일을 재암호화/승격하지 않는다. 일시적 공급자 오류는 `SECURE_STORAGE_UNAVAILABLE`, 그 밖의 복호화 실패는 `STORE_UNREADABLE`이며 파일을 보존한다.
- Linux의 기존 보안 provider 허용 목록은 유지한다. basic_text/unknown에서 비동기 API의 true를 보안 저장 가능으로 해석하지 않고 가용성 질의도 하지 않는다. 보안 저장이 없으면 세션 보관을 선택할 수 있고 평문 파일 대체는 없다.
- OS 작업 자체를 취소한다는 보장은 없다. 완료 결과를 무효화하고, 전송기는 await 전후의 취소·오프라인·전체 기한을 확인한다. IPC도 await 전후 신뢰 프레임과 오프라인을 검사한다. 토큰·OS 예외 원문을 돌려주지 않는다.

## 실제 OS 호환 검사

`npm run test:async-storage:electron`은 임시 프로필에서 write 프로세스를 종료한 뒤 새 read 프로세스를 시작한다. PR30의 fixture 생산자는 **Electron45 동기 API**였다. 그 결과가 Electron26 생성 암호문까지 검증했다는 뜻은 아니다.

이번 Windows CI는 두 경로를 요구한다.

1. Electron45 동기 v1 생산 → 종료 → Electron45 비동기/운영 store 읽기.
2. **Electron26.6.10 동기 v1 생산 → 종료 → Electron45 비동기/운영 store 읽기.**

각 read 단계는 원본 v1 파일의 바이트 불변, async API 왕복, 별도 파일을 쓴 운영 store의 저장/재열기/삭제도 검사한다. 동기 생산자는 운영 writer와 독립된 고정 v1 fixture다. 새 비동기 writer로 fixture까지 바꾸면 과거 암호문 검사가 사라지므로 의도적으로 분리한다.

구버전은 Windows CI 임시 폴더에만 내려받고 앱 의존성/PATH를 바꾸지 않는다. [공식26.6.10 ZIP](https://github.com/electron/electron/releases/download/v26.6.10/electron-v26.6.10-win32-x64.zip)을 [공식 SHASUMS256.txt](https://github.com/electron/electron/releases/download/v26.6.10/SHASUMS256.txt)의 SHA-256 `60ae3be784ef8a44b6ac7d0611944696c43c5b88c943a15f1732058b07c331c7`로 검증한다. 구버전은 합성 암호문 생산만 하며 창·웹 콘텐츠·사용자 프로필을 열지 않는다. E45로 연 프로필을 E26으로 다시 열지 않는다.

보고서는 OS/버전·고정 provider·단계·boolean·네트워크 시도 수뿐이다. 토큰·암호문·키·경로·OS 예외 원문을 싣지 않는다. 모든 세션 네트워크를 차단하고 시도0을 단언한다. Linux CI의 basic provider는 API 존재와 거부 분기만 검사하고 **insecure-provider-not-tested**로 남긴다. 실제 Linux keyring·macOS는 미검증이다. 사용자 Windows10 프로필 이전을 대신하지 않는다.

## 검증과 다음 업그레이드

[이번 전환 기록](validation/2026-11-24-async-token-store.md). PR30의 [기존 CI](https://github.com/HyunnJg/SDStudio/actions/runs/45397025513)는 E45 동일 버전 검사이고 [당시 기록](validation/2026-11-24-async-storage.md)을 소급 변경하지 않는다.

운영 전환/교차 버전 회귀를 완료해도46을 자동으로 설치하지 않는다. 정확한45 pin/설치 gate를 유지하고 다음 메이저의 변경점·설치·창·패키지는 별도 PR에서 확인한다.

공식 근거(2026-11-24 확인): [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage), [고정45.4.1 구현](https://github.com/electron/electron/blob/v45.4.1/shell/browser/api/electron_api_safe_storage.cc). 구현 코드를 복사하지 않았다.
