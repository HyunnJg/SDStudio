# 빈 캐릭터 카드·캐릭터 전용 입력·PNG 진입 검증

2026-11-25 (Asia/Seoul). 기준 main `16814da27f99c95e3fca5c2d86f29eefc3b1ac85`(PR36 병합), 브랜치 `work/character-input-flow`, D-059.

## 범위와 근거

- 실제 생성 대상은 enabled이고 긍정 입력이 비어 있지 않은 카드다. 빈/공백·부정만 있는 카드의 원문·순서·활성 상태는 저장하며 양/음성 API 배열에서 함께 제외한다. 작성 대기를 화면에 표시하고 생성 수와 구분한다. 기존23명·수동 배치·미전개 문법/잘못된 타입 거부는 유지한다.
- V5에서 전송할 캐릭터가 있으면 기본 입력 필수를 해제했다. 품질 none이면 input/base_caption이 빈 문자열이고, 품질 프리셋이 있으면 기존 규칙대로 그 태그가 들어간다. 인원수 태그나 임의 텍스트를 만들지 않는다. V4.5 기본 입력 필수는 유지한다.
- [공식 API 스키마](https://image.novelai.net/docs/doc.json)의 image.ImageGenerationRequest.input, V4ExternalCaption.base_caption, V4ExternalCharacterCaption.char_caption은 string이며 minLength가 없음을 직접 읽어 확인했다. 이는 앱 조건 완화의 근거로 삼은 한정된 스키마 확인이며 실제 서버 검증·성공 비용/그림체 보장이 아니다. [공식 다중 캐릭터 설명](https://docs.novelai.net/en/image/multiplecharacters/)은 인원수/배경/화풍을 기본 입력에 쓰도록 권한다. 사용자에게 그 권장은 유지한다.
- PNG 가져오기는 이미 PR36에 있었고 당시 main에는 미병합이었다. 최종 head0fe297f의 Windows/Linux CI2/2를 재확인해 이번 사용자 진행 승인 후 main16814da로 병합했다. 사용자의 실행 SHA/PNG가 없으므로 보고된 실패 원인을 이 사실만으로 확정하지 않는다. 진입 버튼을 입력 패널에 옮기고 동작을 프롬프트·설정 가져오기로 구체화했다. 로컬 파일 선택/드래그 핸들러는 그대로다.

## 로컬 결과

Linux x64, host Node26.13.1/npm11.20.0, Electron45.4.1/내장 Node24.22.3. 기존 의존성 설치본 재사용이며 npm ci를 재실행하지 않았다. 권장 npm11.21.3 clean 설치 검증은 CI와 구분한다.

- 전체 단위 **312/312** 통과(기존302+바인딩/단일·큐6+공통 판정/React4). 기존 비어 있지 않은 요청·시드·해시·불변 초안과 저장-only/중복 전송 금지 회귀를 포함한다.
- 기다리는 카드의 삭제 복원·부정 유지·활성 전환·22개 실제 입력+10개 빈 카드·기본/실제 캐릭터 모두 없는 경우 전송 전 거부를 확인했다. 빈 기본을 사용하는 단일/큐는 같은 기존 실행 경로에서 PNG/v4/해시를 보관했다.
- 변경5개 TS/TSX eslint 통과. 새 공용 판정·main 바인더·캐릭터 컴포넌트·표시 헬퍼의 독립 strict tsc(`--types node,react`) 통과. 전체 tsc/lint를 통과했다고 표시하지 않는다.
- production main/renderer 전체 빌드와 고지 수집 통과. 고지 패키지215/미해결 원문8은 그대로다. 의존성/lock·네이티브 소스·프로젝트 스키마/버전·토큰/연결 기본값은 바꾸지 않았다.

## 실제 Electron — 헤드리스

이번 환경에는 DISPLAY/Xvfb가 없다. 초기 임시 어댑터로 검사한 뒤, 재현할 수 있도록 테스트 실행기에 명시적 headless/테스트 sandbox 인자를 추가했다. 최종 명령은 `SDSTUDIO_SMOKE_HEADLESS=1 SDSTUDIO_SMOKE_NO_SANDBOX=1 npm run smoke:generation-characters`이며 `--ozone-platform=headless --no-sandbox`를 테스트 자식 프로세스에만 넘긴다. DISPLAY를 가정하거나 제품 설정을 바꾸지 않는다. sandbox 해제는 이 일회용 검사 프로세스뿐이며 제품 설정에 넣지 않았다. 화면을 사람이 조작한 X11/Windows 검사가 아니다.

| 별도 PID | 체크 | 합성 루프백 생성 | 결과 |
| --- | ---: | ---: | --- |
| characters | 9 | 3 | 빈 기본+품질 none, 실제 캐릭터만 단일/2회 큐, 기다리는 카드 보관·390px/밝은 테마 |
| reopen | 3 | 0 | 다른 프로세스에서v4/원본 PNG·순서·기다리는 카드 복원 |
| offline | 10 | 0 | 입력 패널 PNG 진입·일반/Stealth·부분 적용/취소·원문 보존·늦은 읽기 무효화 |

캐릭터 경로 합계 **3PID·22체크**, 합성 루프백3회. 모든 프로세스의 외부 요청0·renderer 오류0·네이티브 종료를 확인했다. 단일 인스턴스 잠금은 기존 하네스에서 모의다. 파일 선택은 FileList/DragEvent 주입이며 OS 파일 선택창을 사람이 누른 검사가 아니다. 최초 검사에는 기다리는 카드를 추가했는데도 기존 하네스가 enabled 전체를2명으로 기대해 실패했다. 실제 전송 대상2명/저장 카드3명과 재열기를 각각 검사하도록 하네스만 고쳤다.

추가 일반 create/reopen/offline 하네스는 최초에 gallery의 ‘썸네일2개 표시’ 대기 시간 초과로 실패했다. 원인을 대조하니 초기 헤드리스 창이 실제1024px이고 결과 패널 display=none이었다. 기존 검사는 데스크톱 패널을 가정하면서 초기 폭을 지정하지 않았다. 검사 시작에1400×900을 명시하고 패널이 보이는지 단언하도록 하네스만 고쳤다. 갤러리 제품 로직·읽기 상한·기대값을 완화하지 않았다. 이후 create25/reopen2/offline10, **3PID·37체크**·루프백3회가 통과했다. 캐릭터 경로와 최종 합계 **6PID·59체크**, 루프백6회/실계정0회이며 실제 서버 요청 수로 세지 않는다.

## 남은 범위

개인 NAI PNG·실계정 요청은0회다. 빈 기본 caption의 실서버 수용·그림체, Windows/macOS 실제 UI·OS 드래그, 실제 표시 서버의 gallery/ASAR 스모크는 이번에 확인하지 않았다. 새 head의 Windows/Linux clean 설치·빌드/패키지 결과는 PR의 해당 CI 링크로 별도 기록한다. PR36의 과거290/302·X11/ASAR 결과로 새 변경을 검증했다고 표시하지 않는다.

다음 [프리셋 라이브러리](../PROMPT_LIBRARY_PLAN.md)와 [V5 이미지 참조](../V5_REFERENCE_RESEARCH.md)는 구현 미착수다. V3 파일/메뉴는 이번에 삭제하지 않았다.
