# V5 캐릭터 자동 배치 검증 — 2026-11-25

기준 main `f7aa35e`(PR33 병합). host Node26.13.1/npm11.21.3, Electron45.4.1/내장Node24.22.3, Linux x64. D-054/P1-02d. 합성 토큰·2px PNG·루프백 응답만 사용하고 실제 계정 호출은0회다.

- 단위272/272 통과(기존263 + 캐릭터9). 순서/양성·음성 대응/비활성 보존,22명 상한·수동/V4.5/인라인 거부, 기존 무캐릭터 본문 동일, 단일 v4/hash/PNG, 복사/직전v3복구/잘못된버전, 혼합 반복 큐/설정 수, pending 저장-only, 예약 캐릭터 변경→전송 전 중지→미전송만 이어가기를 확인했다.
- 변경8개 TS/TSX eslint와 main binding/service·독립 캐릭터 컴포넌트 strict tsc 통과. ConnectedWorkspace에서 전체 renderer 의존성을 따라가는 넓은 tsc는 기존 ElectronFetcher 반환형/libsodium 선언/이미지 선언·모델 코드의 오류로 실패했고 새 ConnectedWorkspace/ConnectedCharacters의 진단은 없었다. 저장소 전체 타입 검사 성공으로 표시하지 않는다.
- production main/renderer/고지 생성 성공(215 packages·원문8건 미해결 유지). 최종 빌드에서도 통과했다.
- 실제 옛 reader 탐침: git show f7aa35e:src/workspaceProject.ts를 TypeScript로 transpile해 실행했다. 기존 v3 입력은 읽고 캐릭터 v4 결과는 PROJECT_VERSION으로 거부했다. 탐침은 저장소에 테스트로 추가하지 않았고 사용자 파일을 쓰지 않았다.

첫 GUI 시도는 빌드 완료를 기다리기 전에 실행해 새 버튼이 없는 번들을 읽고 실패했다(전송0). 빌드 완료 후 재실행해 캐릭터/기존 흐름을 확인했으며 이 하네스 실행 순서 문제를 제품 결함으로 세지 않는다. root 컨테이너의 sandbox/singleton 우회·Xorg는 검사에만 적용한다. 제품 설정은 유지한다.

실제 서버가 캐릭터 요청을 받는지, 모델이 원하는 순서/색/상호작용으로 그리는지, 최대22명 품질은 이 PNG fixture로 확인할 수 없다. Windows/macOS의 실제 캐릭터 창은 미실행이며 CI의 unit/package와 구분한다. 정확한 실서버 MIME은 미확인이다.

## 실제 Electron/패키지 결과

- 캐릭터 UI: 서로 다른3PID/9체크 통과. 실제 Electron session transport→루프백 ZIP→엄격 PNG→worker 저장→화면→새PID 재열기→오프라인 조회. 긍정/부정 짝·비활성 전체 초안·삭제 복원/순서·고스텝 취소의 캐릭터 수·2회 큐 확인과 실제 body를 대조했다. 390px 두 테마에서 가로 넘침이 없었고 desktop 화면도 직접 확인했다. 합성 루프백3회·외부 요청/renderer 오류0·실계정0.
- 기존 단일 흐름:3PID/13체크 통과. 기존 무캐릭터 V5 요청·취소·고스텝·결과 저장-only·테마·재열기 유지. 루프백3회·외부 요청/renderer 오류0. 이후 추가된 것은 캐릭터 패널의 이전 앱 비호환 안내와 삭제 복원 중복 ID 방어이며 최종 캐릭터9체크/패키지에서 재확인했다.
- 실제 Linux directory package의 `generation-characters`:6체크/루프백3회 통과. app.isPackaged=true, ASAR 실행 전후 SHA-256 불변, 격리 프로필, 외부 요청/renderer 오류0. 운영 번들에 하네스를 넣지 않고 검사기만 loopback inspector로 진입 전에 주입했다. ASAR 안 projectWorker.js를 사용했다.
- 디렉터리 패키지 생성과 실제 포함 고지 해시 검사 통과. 고지 원문8건 등 미해결은 유지하며 공개 배포 허가 완료를 뜻하지 않는다.
- `smoke:package`에 generation-characters 모드를 추가했다. 기존 generation 모드의 기대 체크 수9는 PR32의 테마2체크를 반영하지 못한 값이어서11로 맞췄다. 검사 기준을 줄이지 않았다.

반복 실행 명령: `npm run smoke:generation-characters`, `npm run smoke:package -- <absolute-linux-unpacked> generation-characters`. Linux X11이 필요하다. Windows/Linux clean 설치·실제 native·E26→E45 crypto·단위272·production·directory package/고지 CI는 PR의 최종 결과로 연결한다. GUI/ASAR 실측은 Linux이고 CI 패키지 생성과 동일시하지 않는다.

최종 동일 패키지의 기존 `generation` 모드도11체크/루프백3회·isPackaged/ASAR불변/격리/외부0으로 통과했다. 수정한 기존 기대 체크 수도 실제 산출물에서 확인했다.
