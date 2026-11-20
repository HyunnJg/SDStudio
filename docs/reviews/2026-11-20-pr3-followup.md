# PR #3 추가 검토 처리

사용자 제공 Gemini·Claude 의견을 `0b6195f97e92949ad63c528ab07c2ac7ffcd123a`와 대조했다. 이 파일은 구현 담당자의 처리 기록이며 두 AI가 직접 수정하거나 아래 검증을 실행했다는 뜻이 아니다. 기준 날짜는 2026-11-20 (Asia/Seoul).

| 의견 | 처리 | 근거·검증 |
| --- | --- | --- |
| IPv6 hostname 대괄호 | 이미 반영됨 | 기준 커밋에 `[::1]`이 있고 loopback 단위 테스트도 통과. 제시된 `::1` 코드는 기준 소스와 다름 |
| init 실패 시 창 없이 잔류 | 채택 | ready 이후 init을 오류 처리에 연결. 로그·오류 상자 후 exit(1). 로그 기록이 실패해도 오류 상자와 종료를 수행 |
| DEBUG_PROD preload 경로 | 채택 | 배포 자산은 DEBUG_PROD와 분리. 비패키징 development만 DLL preload/data를 선택. 동일 조건이던 data 경로도 보완 |
| 네트워크 차단 범위 명시·새 진입점 검사 | 채택 | ARCHITECTURE에 기본 세션·명시 IPC·loopback의 한계 기록. AST 검토 목록 테스트 추가 |
| Node 네트워크 클라이언트 없음 | 정정 | 기존 localai.ts의 Node fetch 2개, main.ts의 net 포트 탐색 존재. 지정 IPC 선행 차단으로 통제하며 목록에 기록 |
| 업데이트 알림은 릴리스에서도 비활성 | 채택·명시 | P3에서 활성화 결정. enabled=true이면 getVersion이 필수인 타입으로 제한 |
| 예제 export·clipboard·외부 편집 no-op | 채택 | 4개 시스템 동작 및 잔여 크레딧 조회가 명시적 오류를 반환. 이벤트 등록·감시·종료 등 예제 수명 관련 no-op은 유지 |
| 모든 빌드의 폰트 변화 | 채택·명시 | D-011 기록. 로컬 폰트는 라이선스 확인 후 P1에서 평가 |
| 동작 변경의 커밋 분리 | 채택 | 시작 실패·자산 경로 수정과 오프라인 부수효과 보완을 분리 |

## 실패 검사에서 추가로 발견한 문제

오류를 기록하자 electron-log v4가 캐시한 폴백 경로로 원본 appData 아래 `sdstudio/logs`를 생성했다. 격리 모드에서 파일 transport의 resolvePath를 선택된 logs 아래로 명시했다. 실제 Electron 실패 테스트는 원본 폴더 미생성과 격리 로그의 오류 기록을 함께 검사한다. 정상 기동만으로는 발견하지 못한 실패 경로 회귀다.

## 검증

Node 22.4.1 / Electron 26.6.10 / Linux x64. 새 의존성·저장 형식 변경 없음.

- 프로필 13건, 프로필 Electron 2건, 오프라인 11건, 시작 제어 4건, 시작 실패 Electron 1건: 총 31건 통과.
- 메인·렌더러 빌드, 수정 독립 모듈 엄격 타입검사·린트 통과. 전체 저장소 tsc의 기존 TS2688은 별개로 남아 있다.
- `DEBUG_PROD=true npm run build:main`의 실제 Electron 기동: 가짜/파일 백엔드 각각 창·preload 확인. 가짜 큐 PNG 완료, 파일 백엔드 5종 IPC 거부. 두 기동의 관찰된 원격 요청과 렌더러 오류 0건.
- 합성 db.csv 읽기 실패 주입: 오류 상자 호출 관찰 후 실제 종료 코드 1, 창 0개, 원본 appData 비어 있음, 격리 로그에 오류 기록.

실기 검사에서는 인증된 Xorg dummy를 사용했고 환경의 Unix 소켓 제한 때문에 단일 인스턴스 잠금만 하네스에서 모의 처리했다. 실패 테스트의 오류 상자도 네이티브 모달을 대신해 호출을 기록한다. 실제 모달의 모습, 패키징 DEBUG_PROD 앱, Windows/macOS, 종료 저장, 실제 API는 미검증이다. 패키징 여부에 따른 경로 선택은 순수 함수 테스트로만 확인했다. 디스플레이가 없는 Ozone 전체 초기화는 SIGSEGV하여 X11로 전환했다.

```sh
npm run test:profile
npm run test:profile:electron
npm run test:offline
npm run test:startup
DEBUG_PROD=true npm run build:main
npm run build:renderer
# X11 DISPLAY가 있는 Linux에서
npm run test:startup:electron
npm run smoke:offline
npm run smoke:offline -- real
```

`SDSTUDIO_SMOKE_SKIP_SINGLETON=1`은 잠금 제약이 있는 이 검사 환경에서만 지정했다. 제품의 단일 인스턴스 잠금과 OS sandbox는 유지한다.
