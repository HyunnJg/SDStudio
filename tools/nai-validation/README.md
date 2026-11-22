# 실험 창만 설치하기

저장소 루트에서 실행한다. 앱 전체의 npm install은 필요 없다.

```powershell
npm --prefix tools/nai-validation ci
npm --prefix tools/nai-validation start -- "$env:LOCALAPPDATA\SDStudio-Live-Test"
```

Linux에서는 마지막 인자를 /home/your-name/SDStudio-Live-Test 같은 저장소 밖의 전용 절대경로로 바꾼다. Electron 바이너리 다운로드는 필요하지만 Python·Visual Studio·C++ 빌드를 실행하지 않는다. 설치 파일이나 기존 루트 node_modules를 지우지 않는다.

Persistent API Token은 열린 창에 직접 입력한다. 토큰을 명령줄/환경변수/채팅으로 보내지 않는다. 웹의 동일 설정 비용/잔액과 비공개 응답 보관을 확인해야 1회 전송할 수 있다. 상세 조건과 결과 파일은 [실험 안내](../../docs/NAI_LIVE_VALIDATION.md)를 따른다. 일반 작업실·프로젝트 저장 연결을 대신하는 프로그램은 아니다.

Linux Node24.22.3/npm11.19.1에서 독립 npm ci·실제 Electron 창을 검증했다. 사용자가 Windows/Node26에서 공식ZIP 수동 해제 후 GUI/API응답을 보고했다. npm 설치 스크립트 성공은 미확인이고 [부분 설치 복구](WINDOWS.md)를 별도로 안내한다. [정확한 검증](../../docs/validation/2026-11-22-standalone-validation.md).

```sh
npm --prefix tools/nai-validation test
```

두 검사와 Linux X11 실기1건이다. 디스플레이가 없으면 실기는 명시적으로 skip한다. 이 테스트는 강제 오프라인/합성 값만 사용하고 실제 API를 호출하지 않는다.


PR15 이후 응답 수신 보완은 work/p0-live-recovery 브랜치다. 기존 창을 닫고 코드를 갱신한 뒤 의존성 재설치 없이 새 명시적 프로필에서 실행할 수 있다. 첫/다음 웹 표시 비용 합계10 Anlas 이내·동일 요청의 추가1회 조건을 [실험 안내](../../docs/NAI_LIVE_VALIDATION.md)에서 확인한다. 기존 프로필은 지우지 않는다.

기본1장 실측2회는 완료했다. [성공·Opus/Anlas 구분](../../docs/validation/2026-11-22-live-success.md). 위 실행 명령은 도구 사용법이며 추가 전송 요청이 아니다. 기존 결과/프로필을 보존한다.
