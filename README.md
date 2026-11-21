# SDStudio 협업 작업공간

[sunho/SDStudio](https://github.com/sunho/SDStudio)를 기반으로 NovelAI와 익숙한 이미지 생성 UI 및 반복 작업 개선을 검토하는 포크입니다. **현재는 개발 프로필 격리와 오프라인 새 화면을 검증한 단계입니다. 최신 모델의 실제 API·저장 연결은 다음 단계입니다.**

**현재 포크의 기본 실행은 오프라인이며 생성/API 연결이 차단됩니다.** 현재 온라인 선택은 `SDSTUDIO_OFFLINE=0`으로 가능하며, 환경변수 없는 앱 내 전환을 다음 작업에서 추가합니다.

| 문서 | 용도 |
| --- | --- |
| [현재 상태](docs/STATUS.md) | 완료·미완료, 확인한 사실, 바로 다음 작업 |
| [모델/API 설계](docs/NOVELAI_API.md) | 공식 근거, 입력 초안, 실제 연동 전 남은 항목 |
| [작업 계획](docs/ROADMAP.md) | 단계별 작업과 완료 기준 |
| [결정 기록](docs/DECISIONS.md) | 확정한 방향과 제안의 구분 |
| [소스 구조](docs/ARCHITECTURE.md) | 주요 파일과 변경 지점 |
| [개발 시작](docs/DEVELOPMENT.md) | 원본 명령, 환경, 검증 상태 |
| [라이선스 조사](docs/LICENSE_REVIEW.md) | 파일별 증거와 미확인 범위 |
| [다른 AI와 검토하기](docs/reviews/README.md) | 전달할 요청문과 검토 양식 |
| [AI 작업 지침](AGENTS.md) | 작은 브랜치·PR·인수인계 규칙 |

원본 기준: `f2088add103ad683a31e0590448e6e5bb4d71556` (`3.1.11` 표기). 원본 코드·이력·크레딧을 보존합니다. [원작자·출처](CREDITS.md)와 [고지 확인 범위](docs/licenses/APP_LICENSE_STATUS.md)를 함께 제공합니다. `NAI-Auto-Generator`의 코드는 가져오지 않았습니다. 최종 앱 이름과 세부 UI는 미정입니다.

---

# 원본 프로젝트 소개
Stable Diffusion 계열 API와 모델을 사용하기 편하게 해주는 프론트앤드 프로그램입니다. 모든 씬을 여러번 생성 예약을 해놓고 딴거하다가 와서 이미지를 이미지 월드컵으로 선택하고 리터칭하는 작업 흐름에 맞춰져 있습니다.

![](images/img1.png)

![](images/img2.png)

## 주요 기능

### 씬 별 이미지 생성
![](images/img3.png)

### 이미지 월드컵 기능

![](images/img8.png)
	
### 이미지 인페인팅 기능

![](images/img4.png)

### 자동 배경 제거 기능

![](images/img6.png)

### 포토샵 연동 기능

![](images/img5.png)

### 이미지 변형 기능

![](images/img9.png)

### 태그 자동 완성

![](images/img10.png)

###  프롬프트 조각 및 구문 하이라이팅 기능

![](images/img111.png)

### 프롬프트 조합 기능

![](images/img7.png)

## 크래딧

이미지 씬 기능은 https://dendenai.xyz 의 프리셋 기능에서 파생되었습니다.
