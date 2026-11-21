# PR #7 추가 검토 처리

기준: `a21d6e9e181e7563f07a691585ac97cb0e7c7ba9`, 사용자 제공 Gemini·Claude 의견. 처리일: 2026-11-21.

| 의견 | 소스 대조·조치 |
| --- | --- |
| 조사 커밋·수정 여부 누락 | 수정. 두 JSON에 gitHead/dirty/inputBasis 기록. 수정 상태면 stderr 경고. 파일은 working tree, 추적 목록·서브모듈 리비전은 index에서 읽음을 명시 |
| 출력 경로 제한 부족 | 수정. 심볼릭 링크를 resolve한 뒤 저장소 내부는 docs/licenses의 하위 폴더만 허용. 저장소 루트/상위·소스·.git·다른 내부 폴더 거부 |
| 패키징 포함 대상 우선 | 채택. 다음 P0-04b의 첫 단위는 로컬 Linux 디렉터리 패키지의 실측 manifest·중복 제외. 루트 개발 전이 의존성 전체보다 runtime/native/resources를 우선 |
| Noto 3종 미사용 | 정적 검색에서 @font-face/ttf 파일 참조 없음. Noto Sans KR 이름과 동봉 Noto Sans가 다름. 실제 Linux 패키지의 resources/assets/fonts에 3종/OFL 포함 확인. 제외 전후 기동 검증을 다음 PR에서 수행 |
| DB 역할·중복 | desktop=data/db.csv, Android=assets/db.txt, native test=src/native/db.csv 확인. 단, 실제 Linux app.asar에는 node_modules/sdsnative/db.csv도 존재: 'native DB는 배포되지 않을 가능성'은 채택하지 않음. 제거 대상은 실제 포함 경로와 쓰임을 기준으로 결정 |
| 플랫폼 조사 순서 | 현재 Linux 검증과 첫 배포 OS 결정은 구분. 지원 OS 확정 전 Windows/macOS 배포 검증 완료로 표시하지 않음 |
| 수집기 갱신 CI | P3 후보로 기록. 조사 gitHead/dirty는 수집 시점의 맥락이므로 payload 비교와 별도 검증. HEAD가 바뀌었다는 이유만으로 파일 증거가 같다고/다르다고 판정하지 않음 |

## 실행한 검증

`python3 src/__tests__/licenseEvidence.test.py` 5/5 통과: clean snapshot의 HEAD·재현, 수정 입력 경고/해시, source/.git 출력 거부, 허용 폴더, .git을 향한 symlink 거부. 앱·계정/API 호출 없음.

수집기 보완 소스가 반영된 **깨끗한 `fd3307b9525121cf5480bbb711f540d766fea93b`**에서 임시 폴더 2개로 수집했다. 9개 산출물이 바이트 단위로 같고 두 JSON은 gitHead=해당 커밋, dirty=false다. 그 뒤 JSON만 저장소로 옮겼다. 따라서 후속 문서/스냅샷 커밋의 HEAD와 조사 HEAD가 다른 것은 의도된 이력이다.

기존 GPL/OFL 등 원문 7개는 변경하지 않았다. P0-04b는 Linux x64 디렉터리 패키지에 대해 electron-builder 24.13.3 / Electron 26.6.10, publish=never, 로컬 Electron, npmRebuild=false로 첫 실측을 수행했다. 이는 첫 배포 지원 OS 결정·릴리스·라이선스 이행 완료가 아니다. 비교·제외·기동 결과는 다음 PR에 남긴다.
