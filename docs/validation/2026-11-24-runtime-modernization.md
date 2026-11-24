# Node26/Electron45 데스크톱 현대화 검증

- 작성일: 2026-11-24 (Asia/Seoul), 기준 main `fd42ea3a4985e9a5337a14b70dfd59e737b0cdf3`.
- 변경: [D-050](../DECISIONS.md), [버전/설계/공식 근거](../RUNTIME_MODERNIZATION.md). 생성 실험을 보류하고 새 worktree에서 설치/실행 병목부터 처리했다. 기존 정상 체크아웃/사용자 프로필을 삭제하지 않았다.
- 환경: Linux x64, 개발 Node26.13.1/npm11.21.3, Python3.12.14, g++14.2.0. Electron45.4.1 내부 Node24.22.3/modules150/NAPI10. 제품 sharp0.35.5/libvips8.18.7.
- Node 공식 archive는 SHASUMS256과 SHA-256 `5c063e46bab0fbc1c17cc445d7ff129cbdcd0471be6ed83b6ab864f8143bc864` 일치 후 사용했다. 별도 npm11.21.3을 선택했고 루트 npm 의존성에 가려지지 않았다.

## 실행 결과

| 확인 | 실제 실행/결과 |
| --- | --- |
| 빈 worktree 최초 설치 | root npm ci 성공. 자식 lock 설치·공식 Electron45 다운로드·Electron 대상 C++ 빌드·DLL 완료 |
| 최종 setup 재설치 | root npm ci --include=optional 재실행0. 외부 스크립트 미승인 경고 없이1929패키지 설치·자식6/67·native·검사·DLL 완료. dependency deprecation 경고는 남음 |
| 실제 native/PNG | verify:desktop0. Electron 내부에서 native DB 검색과 sharp2×2 RGBA PNG/알파 왕복 성공 |
| CJS 단위 | npm run test:unit,243/243·skip0. 병렬도4에서 연속2회 통과 |
| 라이선스 수집기 | Python5/5, --installed 실제 수집 성공. @img README/versions 증거2개 포함 |
| Electron/독립 도구 | 16건 중15건 최초 통과. 시작 실패1건은 컨테이너 singleton socket 거부. 기존 하네스의 명시적 singleton 모의를 켠 단독 재검사1/1 통과. 즉16개 시나리오를 확인했지만 한 번의16/16 실행은 아님 |
| 개발 엔트리 | profile:check 실제CJS 부트스트랩0. npm start → webpack 개발 서버 → Electron45 창/renderer/preload bridge 정상·렌더러 오류0 |
| 타입/린트 | 새 imageClipboard.ts 엄격 타입0. 변경 TS/TSX2파일 eslint0. 전체 tsc는 기존 libsodium-wrappers TS2688로 실패 |
| production | npm run build0. main/preload/worker/renderer/고지 생성 |
| directory package | builder26.18.0 Linux --dir --publish never0. 기본 @electron/rebuild4.2.1 경로로 native/sharp 재빌드; npmRebuild를 끄지 않음 |
| package notices | 필수5경로·219사본 SHA 대응·번들 출현143·복사metadata74 확인. 미확인 원문8건, 전체 재배포 완료 아님 |
| 실제 ASAR 창 | generation·projects·worker·auth4경로0, 각각 실행 전후 archive 불변. 합성 PNG·클립보드·알파/metadata·복구·새PID 재열기·불안전 키링 거부/세션 토큰 확인 |
| 패키지 모드 재시작 | 실제3개 PID/2회 relaunch,12체크. 오프라인→온라인→오프라인·V3 합성 저장 보존·작업 중 거부·취소 확인. 원격 요청/렌더러 오류0 |
| 단일/반복 창 회귀 | production entry 단일3PID11체크/루프백3회, 반복3PID10체크/루프백13회. 실제 계정0 |
| 이미지 클립보드/런타임 | 실제 IPC copy→clipboard.read→PNG 복호화2×1 성공. 패키지 안 sharp PNG 처리·new console-message details warning 관찰 성공 |
| standalone audit | npm --prefix tools/nai-validation audit: 현재31개 의존성, 보고된 취약점0. 루트 전체 audit0이나 향후 취약점 부재를 뜻하지 않음 |

내용 없는 [요약 JSON](2026-11-24-runtime-modernization.json)을 남긴다. 전체 파일 manifest/로그/프로필/이미지는 커밋하지 않는다. 루프백 HTTP 횟수는 계정/API 호출 횟수가 아니다. sandbox 비활성 인자는 이 컨테이너의 검사 실행에만 명시했고 제품 기본값을 바꾸지 않았다.

## 발견과 수정, 실패 기록

1. 최신 Electron에서 clipboard.writeImage가 제거돼 비동기 ClipboardItem으로 교체했다. 첫 클립보드 하네스는2×1 합성 fixture를2×2로 잘못 기대해 실패했고 올바른 fixture 크기로만 고쳤다.
2. npm start는 내부 Node24의 native .ts/ESM 로더가 ts-node CJS 훅을 건너뛰어 profileBootstrap import 해석에 실패했다. 루트 main을 명시적 start-main.cjs로 바꿔 등록 후 require하게 고쳤다. production 앱 엔트리는 변경하지 않았다.
3. 개발 React가 이미 기본 인자를 가진 WorkspaceProjectControls.defaultProps를 경고했다. 중복 defaultProps 선언만 제거하고 기본값은 유지했다.
4. 제품 변경과 별개로 컨테이너의 networkInterfaces/Unix singleton socket이 막혀 개발 확인에 루프백 인터페이스 대역과 singleton 모의를 사용했다. 임시 test preload를 Electron bootstrap보다 일찍 읽어 실패했던 하네스는 제품 import 시점 hook으로 고쳤다. 모의는 저장소 제품 코드에 들어가지 않는다.
5. 초기 GUI 검사를 패키징/native 재빌드와 동시에 돌려 native 파일이 빌드 중 사라지는 실패가 있었다. 또 clean ci 중 package 하네스가 ws를 찾지 못했다. 설치/재빌드 완료 후 순차 실행해 통과했다. 패키지 projects 검사 한 번은 Render frame disposed로 실패했고 제품 수정 없이 다음 검사/최종4경로에서 통과했다. 원인은 확정하지 않는다.
6. 무제한 병렬 단위+다른 검사를 함께 돌린1회에서 Node26 V8 ReadSingleBytecodeData fatal이 발생했다. 같은 프로필 시나리오를 단독5회 재실행해 재현되지 않았다. 최종 단위 명령의 병렬도를4로 제한하고243건 연속2회 통과했다. 병렬도가 원인이라고 확정하거나 런타임 버그를 해결했다고 주장하지 않는다.

## 남은 범위

- Windows clean 설치/VS2026 실제 빌드·Windows/macOS 패키지·설치 프로그램·서명·실제 정상 키링은 이 Linux 실행에서 미검증이다. Windows-2025/Linux CI는 같은 설치/프로필/단위/빌드/패키지/고지 명령을 구성했으며 실제 실행 결과는 PR 체크에서 따로 확인한다.
- Linux sharp/전역 GLib 경고 및 한 차례 GLib critical, 동기 safeStorage deprecated 경고는 남았다. 처리한 합성 PNG/GUI는 통과했지만 모든 포맷/환경을 보증하지 않는다. 경고를 숨기거나 token file 정책을 바꾸지 않았다.
- 기존 libsodium 타입 stub, 레거시 로컬 AI/ExifTool/다른 전이 의존성의 deprecation·취약점 정리는 별도다. 공개 배포 전 원문 고지8건·앱/DB/자산 출처·LGPL 조건·fuse는 남는다.
- NAI 실제 계정/키 입력·V5 출력/품질·모델 확장 실험0회. 사용자 Windows 환경의 정상 활성화 스크립트/lock/이미지/토큰에는 접근하지 않았다.
