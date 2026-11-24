# 비동기 토큰 보관 전환 준비 — P0-01e-a

기준 main `c48814a` (PR29 병합), 2026-11-24. Electron45의 동기 safeStorage가46에서 제거 예정이므로 먼저 **기존 v1 암호문 읽기 호환**을 별도 검사한다. 이번 PR은 테스트 진입점/CI만 추가하며 운영 토큰 저장소·IPC·계정 요청을 비동기로 전환한 것이 아니다.46 설치 차단은 유지한다.

## 이번 검사

`npm run test:async-storage:electron`은 스스로 만든 임시 프로필에서 실제 Electron 프로세스2개를 순서대로 실행한다. 첫 프로세스는 고정된 **기존 동기 encryptString**과 v1 envelope로 합성 토큰을 저장하고 정상 quit으로 종료한다. 두 번째 프로세스는 같은 테스트 프로필에서 decryptStringAsync로 그 암호문을 읽고, 새 비동기 encrypt/decrypt도 왕복한다. 읽기/rotation hint가 기존 v1 파일을 바꾸지 않았는지 바이트 비교한다.

보고서는 OS/런타임 버전·고정 provider 구분·성공 여부/고정 단계·rotation boolean·Electron 세션 네트워크 시도 수뿐이다. 토큰·암호문·키·경로·OS 예외 원문은 보고서에 싣지 않는다. 계정 API는 import하거나 호출하지 않는다. 임시 프로필/암호문은 검사 후 정리하며 일반 앱 프로필과 TOKEN.txt를 읽지 않는다.

Windows CI는 실제 OS 보안 저장의 호환·재시작·왕복을 모두 요구한다. Linux CI는 password-store=basic을 명시한다. 이 경우 API 존재와 **안전하지 않은 provider를 알고 암호문 검사를 하지 않는 분기**만 검증하고 `insecure-provider-not-tested`를 기록한다. Linux test가 성공했다고 실제 keyring 호환을 통과했다고 표시하지 않는다. macOS·실제 Linux keyring은 별도다.

## 다음 통합의 완료 조건

- 운영 store의 상태/읽기/쓰기·IPC/연구 창 ready·전송 token supplier를 비동기 계약으로 함께 전환한다. Promise를 기다리지 않아 준비/전송이 먼저 진행되는 경로가 없어야 한다.
- OS 암호화 대기 중 토큰 교체·삭제·lock이 들어오면 늦은 평문 반환/이전 토큰 부활/이전 쓰기를 막는다. 최신 변경과 실패 보존을 테스트한다.
- 기존 v1 암호문은 읽을 수 있어야 하고, 손상/상위 버전/일시적 사용 불가에서 원본 바이트를 유지한다. read와 key rotation hint만으로 파일을 자동 덮어쓰지 않는다.
- secure provider가 없으면 평문으로 떨어지지 않고 세션 보관을 유지한다. 토큰·OS 예외 원문은 IPC/로그로 보내지 않는다. 프레임/오프라인 거부·전송 전 취소/기한 검사는 유지한다.
- 이 호환 probe와 통합 회귀가 완료된 뒤에만 Electron46 업그레이드 차단을 별도 검토한다. 현재 실제 버전은45.4.1이다.

이 검사가 실계정 토큰이나 사용자의 기존 암호문을 받는 절차는 아니다. 사용자의 실제 키링/Windows10 GUI 확인은 대신하지 않는다.

공식 근거(2026-11-24 확인): [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage), [고정 Electron45.4.1 구현](https://github.com/electron/electron/blob/v45.4.1/shell/browser/api/electron_api_safe_storage.cc). API/호환 설명을 확인했으며 upstream 구현을 복사하지 않았다.

## 실행 결과

[Windows/Linux CI run45395949082](https://github.com/HyunnJg/SDStudio/actions/runs/45395949082), 코드9719178에서 두 job 성공. Windows의 실제 암호문 재시작 읽기·비동기 왕복·기존 파일 불변을 확인했다. Linux basic 분기와 기존245건·양쪽 production/패키지/고지 검사도 성공했다. [상세 기록](validation/2026-11-24-async-storage.md). 이 결과는 운영 store 전환이나 사용자 키링 이전을 완료했다는 뜻이 아니다.
