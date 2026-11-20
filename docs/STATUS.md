# 현재 상태

갱신일: 2026-11-20 (Asia/Seoul)

## 현재 단계

**PR #2 보완·병합 / P0-02 구현 및 Linux 전체 화면 검사.** [프로필 검증](validation/2026-11-20-p0-profile.md), [추가 검토 처리](reviews/2026-11-20-pr2-followup.md), [오프라인 기동 검증](validation/2026-11-20-p0-offline.md)을 참고한다.

| 항목 | 상태 | 근거 |
| --- | --- | --- |
| GitHub 작업공간 | 생성 완료 | [HyunnJg/SDStudio](https://github.com/HyunnJg/SDStudio), 공개 포크 |
| 원본 기준 | 고정 | `sunho/SDStudio@f2088add103ad683a31e0590448e6e5bb4d71556` |
| 원본 버전 표기 | 확인 | 루트 및 `release/app/package.json`: `3.1.11` |
| 인수인계·설계·검토 문서 | 작성 완료 | 이 문서, ROADMAP, DECISIONS, ARCHITECTURE, DEVELOPMENT, LICENSE_REVIEW, reviews |
| 코드 구조 조사 | 정적 확인 완료 | React/Electron, 서비스·백엔드 분리, NovelAI V3 매핑 |
| 의존성 설치 / 앱 빌드 | Linux 통과 | 네이티브·DLL·메인·렌더러 성공. 별도 깨끗한 체크아웃 npm ci도 성공 |
| P0-01a 프로필 격리 | 구현·드라이런 검증 | 추가 보완 후 단위/진입·명령 테스트 13건, Linux Electron 테스트 2건 통과 |
| 전체 UI 기동 | Linux 조건부 통과 | 실제 Electron의 가짜/파일 백엔드 2경로. 단일 인스턴스 잠금만 하네스에서 모의 처리 |
| P0-02 서비스·백엔드 | 구현·검증 | 9건 통과. 두 전체 기동의 원격 요청·렌더러 오류 0건, 예제 대기열 1건 완료 |
| 타입검사 | 새 모듈 통과 / 전체 저장소 실패 | 전체 tsc는 기존 libsodium 타입 선언 TS2688. 빌드는 transpileOnly임 |
| 실제 NovelAI API 생성 | 미실행 | 자격증명 사용 및 과금 없음 |
| 다른 AI의 독립 검토 | 수령·계획 반영 | [Gemini](reviews/2026-11-20-gemini-initial-review.md), [Claude](reviews/2026-11-20-claude-initial-review.md), [처리 결과](reviews/2026-11-20-review-resolution.md) |

## 이번에 확인한 사실

- 기존 장점: 씬별 예약 생성, 이미지 선별, 인페인팅, 프롬프트 조각과 조합. 원본 README와 해당 소스가 존재한다. 현재 환경에서 기능 작동을 검증한 것은 아니다.
- `src/renderer/backends/genVendors/nai.ts`는 `nai-diffusion-3` 계열을 매핑한다. 최신 모델 호환성은 별도로 확인해야 한다.
- 원본 전체 트리에서 독립된 LICENSE/NOTICE 파일은 찾지 못했다. 루트와 배포 패키지는 MIT, 네이티브 패키지는 ISC로 표기한다. [확인 범위](LICENSE_REVIEW.md)를 참고한다.
- 원본 IP 확인은 온라인 모바일 분기에만 남겼다. 데스크톱에서는 호출·UUID 저장을 하지 않는다. 업데이트는 기본 비활성이고 포크를 참조한다.
- 업데이트 생성자의 자동 시작을 제거하고 중복 run과 stop을 테스트했다. 오프라인 로컬 AI와 계정/API·다운로드는 실행 전에 거부한다.
- 격리 프로필에서는 원본 userData 조회 부작용도 피하며 saveLocation을 무시한다. 원본 커스텀 저장 폴더는 자동 탐지하지 않으므로 그 안에 개발 프로필을 만들지 않는다.
- `<모음.조각>`과 `multi` 랜덤 선택은 이미 구현돼 있다. 선택은 `Math.random()`을 사용한다. P2-01을 새 기능이 아닌 재현성·기록 개선으로 수정했다.
- 원본 CI에는 다중 OS 패키징, 서명, 릴리스 및 Pages 배포 구성이 있다. 이 포크에서 활성화하거나 실행하지 않았다.

## 바로 다음 작업

1. **P0-03:** 공식 모델/API 규격과 지원 입력·저장 호환 범위를 결정한다. 실제 호출 성공과 문서·픽스처 검증을 구분한다.
2. **P0-04:** 태그 DB·자산·동봉 바이너리 고지 조사를 이어간다.
3. **P1-01:** 모델 입력 범위를 정한 뒤 화면을 재배치한다. 종료 저장·기존 데이터·PNG 메타데이터 회귀 검증도 추가한다.
4. **실기 한계 보완:** Windows/macOS, 실제 단일 인스턴스 잠금, 독립 브라우저 미리보기는 아직 미검증이다.

상세 완료 기준은 [ROADMAP.md](ROADMAP.md)에 있다. 검토자는 저장소를 읽은 **실제 커밋 SHA**를 의견에 적는다.

## 미정 사항

- 최종 앱 이름, 색상·세부 배치.
- 최신 NovelAI 모델 중 지원할 정확한 범위와 파라미터.
- 외부 오픈소스 후보 및 실제 도입할 코드.
- 첫 배포 시점과 지원 OS 범위. 첫 실행 재현은 개발 편의를 위한 제안이며 지원 정책 확정이 아니다.
