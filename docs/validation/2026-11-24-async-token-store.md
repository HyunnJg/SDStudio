# 운영 async tokenStore 검증 — 2026-11-24

기준 main `c6ceb01`(PR30 병합). 작업 P0-01e-b / D-052. Linux x64, host Node26.13.1/npm11.21.3, 실제 Electron45.4.1/내장Node24.22.3. 합성 토큰·임시 프로필·루프백만 사용했다.

| 검사 | 결과/범위 |
| --- | --- |
| 전체 단위 `test:unit` | 255/255 통과. 기존245 + 비동기 저장/IPC/전송9 + 연구 ready1 |
| 변경 TS eslint·store/IPC strict tsc | 통과. 저장소 전체 타입 검사를 성공했다고 주장하지 않음 |
| production build | main/renderer·고지 생성 성공(215 packages, 원문8건 미해결 유지) |
| 실제 Electron 검사 | 10/10: OS probe1·auth/session transport1·연구 창8. Linux basic provider는 안전한 거부 분기만 검사, 실제 keyring 암호화 미검증 |
| 새 작업실 UI | 서로 다른3PID/11체크, V5 단일 클릭·취소·고스텝 확인·저장-only 복구·오프라인 재열기. 루프백3회, 외부 요청/renderer 오류0, 실제 계정0 |
| Windows/Linux CI | [run45402962961](https://github.com/HyunnJg/SDStudio/actions/runs/45402962961)에서 Windows/Linux 2/2 성공. 코드0bc6b36 |

Linux GUI는 임시 Xorg에서 실행했고 root 컨테이너의 sandbox/singleton 우회는 검사에만 적용했다. 제품 설정을 완화하지 않았다. PNG·토큰·원문·절대경로·암호문은 커밋하지 않는다. UI 생성 요청 목적지는 하네스 안에서만 loopback으로 바꿨다. 연구 창 검사는 합성 HTTP/ZIP만 사용하며 실제 사용량을 소비하지 않았다.

주요 회귀: encrypt 대기 중 clear/lock/새 session 선택, decrypt 대기 중 교체/clear, 진행 중 저장을 기다리는 read, rotation hint 파일 불변, 외부 상위버전 파일 보존, 일시적 provider 실패, await하는 auth IPC와 연구 ready 동시 진입/취소. 중단된 OS 작업 자체를 취소하는 구현은 아니다.

Windows 교차 버전 검사는 PR30의 E45 sync→async에 더해 CI 전용 E26.6.10 sync producer→E45 async/운영 store read를 실행한다. 이 Linux 환경에서 Windows 암호화·PowerShell 설치 스크립트를 실행했다고 표시하지 않는다. macOS/실제 Linux keyring은 미실행이다.

사용자는 Windows에서 npm install/build/lint/start와 V5 생성 성공을 보고했다. 정확한 checkout/버전·MIME·비용·키링 보관 여부가 없는 사용자 관찰이며 이번 코드 전환의 실계정 테스트로 세지 않는다. 추가 키나 반복 생성을 요청하지 않았다.

## Windows/Linux CI 확인

코드 `0bc6b36093b8545bbf59b83a039ba82d9956e086`, [Desktop runtime checks run45402962961](https://github.com/HyunnJg/SDStudio/actions/runs/45402962961)의 두 job이 모두 성공했다. 실제 로그를 확인했다. clean 설치·실제 native/PNG·격리 개발 진입·단위255·production build·디렉터리 패키지·패키지 고지까지 포함한다. Windows 고지 집계는214 packages/원문7건 미해결이며 Linux는215/8이다. unresolved0이나 공개 배포 승인으로 해석하지 않는다.

Windows OS 결과(합성 문자열/네트워크 시도0):

| producer → reader | legacyReadableAfterRestart | productionStoreRead | asyncRoundTrip | productionStoreRoundTrip | legacyFileUnchanged |
| --- | --- | --- | --- | --- | --- |
| E45.4.1 sync → E45.4.1 async | true | true | true | true | true |
| E26.6.10 sync → E45.4.1 async | true | true | true | true | true |

E26 producer의 내장 Node는18.16.1이며 asyncMethodsPresent=false였다. E45 consumer는24.22.3/true로 확인했다. 두 경로 모두 새 PID에서 읽었고 rotationRequested=false였다. productionStoreRoundTrip은 별도 async 파일의 쓰기·읽기·새 store 재열기·삭제이며 프로세스 재시작 증명은 legacyReadableAfterRestart다. 실제 사용자 키/파일/기존 profile을 검사하지 않았고 Windows10·macOS·Linux 실제 키링까지 일반화하지 않는다.
