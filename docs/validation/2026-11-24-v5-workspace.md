# V5 Full 바인딩·간단한 생성 흐름 검증

2026-11-24 (Asia/Seoul). 기준 main e36b94f, 런타임 `088932fa3d085260d20d8ca125e92b544ac43b61`, tree `1781faa71c5c54bd3352f993f2c7c712ba0c7e3e`. [정제 JSON](2026-11-24-v5-workspace.json), [출처/한계](../NAI_V5_BINDING.md), D-048. 열린 PR26/27의 변경도 보존해 포함한다. 이력상 병합했다고 주장하지 않는다.

## 변경과 단위 검사

- 새 입력 V5 Full·832×1216·23/7·무작위·Standard/Heavy, 세 크기·품질/부정 선택·스텝/가이던스와 모델별 binding을 구현했다. 실제 전송 UTF-8 본문 SHA-256/확정 seed·원본 draft를 보관한다. V4.5 기존 기본512px 요청은 같은 바이트를 유지한다.
- v3 최소 버전 계산/읽기·위장 다운그레이드 거부, 새 선택 저장 전 v1/v2 원본 보존·직전 v1 이력 복사 복구, 혼합 모델 큐4건의 각 실제 본문·시드/설정, 저장 실패 뒤 API 추가 호출 없는 복구를 검사했다. 신규 V5 테스트7건을 포함해 관련176/176, 실패/건너뜀0이다.
- 기본 online(파일 없음)·기존 saved offline 유지·손상/상위 파일 fail-closed·mock/env/development 우선순위, 보안 저장 가능/불가·기존 session 선택의 기억하기 기본값을 검사했다. 단일 클릭/반복 확인 단순화는 메인 일회용 ticket/직렬 실행/미저장 PNG 복구를 바꾸지 않는다.
- 변경 TS/TSX14개 lint와 scoped strict tsc 통과. production main/preload/worker/renderer·고지 생성 통과, 마지막 버튼 위치/문구 변경 뒤 renderer를 다시 빌드했다. 전체 저장소 tsc의 기존 TS2688을 해결/통과했다고 표시하지 않는다.

## 실제 Electron와 패키지

| 경로 | 결과 |
| --- | --- |
| 단일 UI create/reopen/offline | 최종3PID·8체크·loopback HTTP3회, 생성 한 번/취소/저장-only 복구·다른 PID와 오프라인 재열기 |
| 반복 UI queue/reopen/offline | 3PID·10체크·loopback13회,3씬×2회/중지·이어가기·저장 실패/복구 |
| 오류 UI errors/reopen/offline | 3PID·9체크·loopback4회,429 뒤 TIMEOUT·폴링 보류 중 저장 복구/충돌 씬 제외 |
| 최종 Linux ASAR generation/queue/errors/auth | 4경로·각6/8/7/10체크 통과, app.isPackaged=true·프로필 격리·실행 전후 archive 불변 |
| 최종 native 연결 모드 | 3PID·12체크·실제 relaunch2회, 저장된 offline→online→offline·V3 저장/미완료 run 차단·토큰 local check |
| 최종 패키지 고지 | 사본250개 hash·번들143발생·runtime112 metadata 대응, 기존 미해결8건 유지 |

최종 ASAR 안 projectWorker.js는 unpacked=false다. archive SHA-256은 정제 JSON에 둔다. 테스트 하네스는 loopback inspector로 주입하고 app.asar를 수정하지 않았다. Xorg dummy DISPLAY·테스트 전용 no-sandbox/singleton 대체·390px 최소폭 override와 loopback 목적지/합성 토큰을 쓴다. 계정 호출0·외부 요청0·renderer 오류0이다. 합성 응답은 작은 PNG이므로 실제832×1216 생성 품질/모델·서버 파라미터 수용 검사가 아니다.

검증 시점: 최종176단위·단일 UI3PID·ASAR4경로·재시작3PID는 마지막 런타임 변경 뒤 실행했다. unpackaged 반복/오류3PID는 마지막 생성 버튼 위치·V5 두 false 플래그·문구 변경 전에 실행했고, 같은 기능 경로를 최종 ASAR에서 다시 확인했다. 초기 재시작 검사는 과거의 ‘0이어도’ 문구를 기다리다 실패했다. 현재 ProjectController가 active run에서 먼저 PROJECT_NOT_READY로 차단하는 실제 계약에 맞춰 메시지 검사를 수정했고, run 종료 전 relaunch0회/해제 뒤 native 재시작 조건은 그대로 검사했다. 제품의 차단을 완화하지 않았다.

Linux x64·Node22.4.1·npm11.19.1·Electron26.6.10(Node18.16.1)·builder24.13.3. npm11.19.1은 Node22.4.1 미지원 경고가 있어 권장 신규 설치 조합은 아니다. 기존 의존성 재사용이며 npm ci/native rebuild는 하지 않았다. Electron의 버스/udev 제한과 합성 TOKEN.txt 부재 로그는 환경/fixture 범위로 기록하고 숨기지 않는다.

## 남은 실측

- **image_format=png V5 서버 수용은 미확인**이다. 공개 웹 클라이언트의 WebP→PNG 내보내기와 이 요청 선택은 다르다. ZIP/PNG 검사를 풀거나 실제 출력 품질이 같다고 주장하지 않는다.
- OS 정상 키링의 영구 저장·Windows/macOS·Node/Electron 현대화·사용자 로컬 Codex 변경의 통합은 아직 자동 검증하지 않았다. 사용자 기동/이전 이미지 보고를 이 런타임 실측으로 확대하지 않는다.
- 실제 MIME과429 빈도/Opus 사용량도 여전히 미확인이다. 사용자1장 확인은 [절차](../WORKSPACE_LIVE_CHECK.md)를 따른다. 키·PNG/원문·계정 정보는 수집하지 않는다.
