# PR #8 추가 검토 처리

기준: `7b2daf73cdd51e6e001ea4cc8b9e4157e6bbdc47`, 사용자 제공 Gemini·Claude 의견. 처리일: 2026-11-21.

| 의견 | 판단·다음 조치 |
| --- | --- |
| 전체 JSONL 이력 증가 | 채택. 이번 전후 전체 manifest는 기준선으로 보존하고 다음부터 비교 요약·검사 결과를 커밋. 전체 파일 목록은 로컬 재생성을 기본으로 함 |
| 앱 LICENSE·번들 npm 고지 누락 | 확인. 다음 작업을 고지 묶음의 생성·패키지 포함·실제 경로 검사로 정함. webpack의 주석 LICENSE를 전수 고지로 취급하지 않음 |
| 원본 MIT 문구 | f2088의 조상인 초기 커밋 7091c9135bf0ddd29710e78f907906db96ea4975의 LICENSE를 발견. 내용은 Electron React Boilerplate의 MIT 고지이며 fb2582c에서 삭제됨. 이를 Sunho Kim의 별도 저작권 표기로 바꾸지 않고 원문 복원·정확한 범위 설명을 다음 PR에서 처리. 앱 고유 저작권 문구는 여전히 미확인 |
| inspector / RunAsNode fuse | P3에 릴리스 fuse 제한·실제 포트/실행 검사 및 현재 스모크 방식 변경을 함께 등록. 이번에 fuse를 바꾸거나 현재 검사를 hardened release 검증으로 표시하지 않음 |
| 소스맵·sharp 헤더 | 후속 용량 후보. 오류 보고/네이티브 실행과 LGPL 관련 자료 보존을 결정한 뒤 별도 PR로 검증. 이번 고지 작업과 섞지 않음 |
| Windows/macOS 필터 범위 | Linux만 실측한 상태 유지. 첫 해당 OS 패키징 때 native/ExifTool/generic unpack 패턴 및 고지 경로 검사 반복 |

독립 리뷰의 산술·manifest 분석을 수령했다. 이번 문서 반영에서 패키징·실행을 다시 돌리지 않았다. PR #8의 Linux 전후 17시나리오·기동 불변 검증은 기존 기록을 따른다. 이 처리표는 전체 배포 조건이나 법적 적합성 완료를 뜻하지 않는다.
