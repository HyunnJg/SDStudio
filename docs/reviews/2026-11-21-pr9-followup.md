# PR #9 추가 의견 처리

기준: `96fd2a6`. 사용자가 전달한 Gemini·Claude 검토를 소스와 대조했다.

| 의견 | 처리 |
| --- | --- |
| 루트 LICENSE의 ERB/앱 범위 오해 | ERB 원문을 LICENSES/electron-react-boilerplate.txt로 이동. 바이트 불변. 패키지·수집·검사·fixture 경로 수정 |
| 원작자 확인을 기다릴지 | 사용자는 원본 귀속을 유지하며 개발 지속 결정(D-024). 외부 연락 미실행. CREDITS를 저장소와 패키지에 포함 |
| 원문 누락 8건 | MIT 패키지 5개, native ISC 1개, 내장 metadata 2개로 구분. 상위 고지로 충족됐다고 아직 판정하지 않음. 기존 엄격 검사 유지 |
| beforePack 인자 혼동 | context를 전달하지 않는 명시적 wrapper로 CLI/훅 경계를 분리 |
| 플랫폼별 차이·오류 hash 상세·README 집계 | 남은 배포 확인 목록 유지. 이번 기능 전환의 선행 조건으로 추가하지 않음 |

검증: Node 22.4.1 고지 테스트 3/3·수집 경로 테스트 5/5 통과. 전체 빌드(Node 24.22.3) 및 Linux 실제 directory package(Node 22.4.1) 생성 통과. 고지 경로 5개·사본 250개·복사 metadata 112개 확인. 엄격 검사는 기존 8건으로 종료 코드 1 유지. UI 코드 변경이 없어 전체 기동은 반복하지 않았다. [패키지 검사](../validation/2026-11-21-pr9-followup.json). 과거 고지/라이선스 증거 JSON은 당시 커밋의 스냅샷이며 이번 경로로 소급 수정하지 않는다.
