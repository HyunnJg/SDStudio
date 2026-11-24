# P0-01e-a 실제 OS 암호문 호환 검증

2026-11-24(Asia/Seoul). 기준 main c48814a, 검증 코드97191788d0841037773da1cc49ab6c271cf10465. [CI run45395949082](https://github.com/HyunnJg/SDStudio/actions/runs/45395949082) Windows-2025(job138451635370)/Ubuntu24.04(job138451634831) 모두 success.

- Windows: Electron45.4.1/내부Node24.22.3. 비동기 암호화 사용 가능. 첫 PID의 기존 동기 encryptString/v1 암호문을 정상 종료 뒤 새 PID의 decryptStringAsync로 읽음. 새 encryptStringAsync/decryptStringAsync 왕복도 성공. shouldReEncrypt=false, 기존 v1 파일 바이트 불변. 두 프로세스의 세션 네트워크 시도0.
- Linux: --password-store=basic을 강제해 async API 존재와 provider 구분을 확인. 암호화 사용 가능 여부를 조회하거나 파일을 만들지 않고 insecure-provider-not-tested를 기록. test1건 성공은 이 분기 성공이며 실제 Linux keyring 암호문 호환 성공이 아니다.
- 양쪽 새 Electron 검사1/1, 기존 단위245/245, production build·기본 native rebuild/디렉터리 패키지·고지 검사 성공. Windows 고지217사본/runtime metadata73.
- 로컬 Node26.13.1/npm11.21.3에서도 기존245건·production build·새 Linux 분기1건·새 CJS no-undef 검사/문법·문서 링크 검사 성공.
- 실제 토큰/사용자 프로필/계정 API0. 기존 암호문은 고정된 동기 API로 만든 합성 fixture이며 사용자 파일이나 PR 이전 앱에서 가져온 개인 토큰이 아니다. 임시 파일은 검사 후 정리한다.

보고서는 고정 단계·boolean·런타임/OS 버전뿐이다. 실제 Windows10 GUI/키링·macOS·Linux 보안 keyring 및 Electron46 자체는 미실행이다. 운영 store/IPC/caller를 async로 바꾸는 작업과 대기 중 변경/잠금 회귀는 후속이다. Electron46 설치 차단을 유지한다.
