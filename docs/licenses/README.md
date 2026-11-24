# P0-04a 자산·설치 파일 증거

현재 런타임 갱신(D-050)은 sharp0.35.5/libvips8.18.7과 @img 패키지 구성을 쓴다. [이번 수집·검증](../validation/2026-11-24-runtime-modernization.md)은215레코드/219사본/원문 미확인8건이다. 아래0.32.6/vendor8.14.5 및244/250 수치는 PR7~9 당시 이력으로 보존하며 현재 설치에 소급하지 않는다. 누락8건에는 새 @img/sharp-libvips-linux-x64 원문 미확인이 포함되고 이전 beep-boop metadata는 현재 산출물에 없다. README의 라이선스 표/versions 증거 보존과 전문 충족 판정은 구분한다.

조사일: 2026-11-21. 기준: PR #6 보완·병합 `94edf307331ece82004b60cee185957727c51985`.

이번 범위는 **추적 자산 목록, lock 선언, 선택한 Linux 설치 파일의 원문 고지 수집**이다. 전체 의존성의 권리 조사나 배포 산출물 검토를 완료한 것은 아니다. JSON의 `provenanceStatus: not-cleared`는 출처/재배포 확인이 끝나지 않았다는 뜻이며 라이선스가 없다는 단정이 아니다.

## 확인한 증거와 조치

| 대상 | 직접 확인한 사실 | 조치·남은 범위 |
| --- | --- | --- |
| NotoSans 3종 | sfnt name 필드의 저작권은 2022 The Noto Project Authors, 버전 2.013, 라이선스는 SIL OFL 1.1과 URL. Regular/Bold/Italic 동일 표기 | 메타데이터의 저작권 문구와 일치하는 공식 저장소의 `OFL.txt`를 고정 커밋에서 그대로 가져와 `assets/fonts/OFL.txt`에 추가. 실제 폰트 취득 이력·바이너리의 원 배포본 대조는 남음 |
| sharp 0.32.6 | npm 선언 Apache-2.0. 설치된 libvips 8.14.5 고지는 libvips·glib·pango·libheif 등 LGPLv3 항목을 별도로 나열 | 패키지 LICENSE, 동봉 THIRD-PARTY-NOTICES와 버전 목록을 원문 보존. 각 라이브러리 전문·소스 제공/재링크 조건 및 실제 패키징 포함 확인은 P0-04b |
| exiftool-vendored 27.0.0 / .pl 12.85.0 | wrapper의 MIT 선언과 별도로 `.pl/LICENSE`는 본체가 Perl과 같은 조건이라고 구분. bin/README에는 Phil Harvey 저작권과 같은 표기. bin/LICENSE는 GPL v3 전문 | 세 층의 고지를 보존하고 단순 MIT로 합치지 않음. Perl 조건의 적용 방식·동봉 GPL 문서 관계·Windows exe 구성은 추가 확인 |
| 태그 DB 3파일 | `assets/db.txt`와 `release/app/data/db.csv`는 동일 SHA-256/124,732줄. `src/native/db.csv`는 다른 SHA-256/124,762줄 | 세 파일을 구분해 기록. 원 데이터 출처·변환·허가를 아직 확인하지 못함. 제외 시 빈 DB 기동/자동완성 대체 필요 |
| 추적 자산 | 문서 캡처를 제외한 이미지·폰트·아이콘·예제·태그 DB 등 101파일의 경로·크기·해시 수집 | 루트 아이콘·styles·기본 그림체·Android/iOS 아이콘까지 포함. 라이선스 확인 완료 목록이 아님 |
| npm lock 3개 | 루트 2,212 / 배포 101 / native 6개 lock 항목. license 필드 없는 항목은 각각 6/1/0개 | 이 중 2개는 local link. 나머지 5개는 루트 lock 항목(dev 표시 3개·그 외 2개)이며 선언 누락만으로 무허가 판정하지 않음. 직접 의존성과 전체 선언별 집계를 기록; 전이 의존성 전체 고지는 아직 수집하지 않음 |
| Python/로컬 AI | requirements는 UTF-16 BOM. 버전 pin과 추가 index 지시를 읽어 목록화 | 설치·바이너리/가중치 취득·각 의존성 라이선스 검증은 하지 않음 |
| 원본/서브모듈/보일러플레이트 | package.json 표기와 기존 조사·gitlink SHA 유지 | 원본 MIT/네이티브 ISC/배경 모듈의 정확한 전문·저작권, .erb의 사용 리비전과 원 고지는 미해결. 임의 저작권 연도/전문을 만들지 않음 |

## 파일과 재현

- [추적 파일·폰트 메타데이터·lock 집계](generated/tracked-inventory.json)
- [설치된 Linux x64 패키지와 원문 해시](generated/installed-linux-x64.json)
- [원문 고지 복사본](generated/notices/)

```sh
# Python 3.9+ 표준 라이브러리만 사용. 네트워크/앱 실행/추가 의존성 없음.
python3 .erb/scripts/collect-license-evidence.py
# npm ci 뒤 Linux x64에서 선택한 설치 파일까지 수집
npm run licenses:evidence
# 비교할 때는 새 출력 폴더 사용
python3 .erb/scripts/collect-license-evidence.py --installed --output /tmp/sdstudio-license-evidence
```

`git ls-files`로 추적 파일만 읽고, docs의 작업 화면 캡처는 제외한다. 고지 파일은 바이트 그대로 복사한다. `--installed`가 없으면 node_modules를 읽지 않는다. 지정한 설치 대상이 없으면 available=false이며 전수 수집 성공으로 표시하지 않는다. 현재 유효한 복사본은 installed JSON이 참조하는 파일들이다. 스크립트는 기존 출력 폴더의 다른 파일을 삭제하지 않는다.

npm 집계는 lock **항목** 수로, 동일 패키지의 중복 경로나 local link도 포함한다. 선언된 license는 법적 결론이나 바이너리 고지의 대체가 아니다. 기록한 build.files/extraResources/asarUnpack은 설정이며 실제 배포 파일 manifest가 아니다.

## 공식 원문과 보존 범위

- Noto 원문: [고정 커밋 ffaec0a의 OFL.txt](https://github.com/notofonts/latin-greek-cyrillic/blob/ffaec0a756877220dbf718ce08b8479a0be82479/OFL.txt). [추가한 원문](../../assets/fonts/OFL.txt). 저작권·문구를 수정하지 않았다. P0-04a에서 자산 옆에 원문을 보관했으며 새 폰트 적용/교체는 하지 않았다. P0-04b1 필터는 미사용 fonts 폴더 전체를 데스크톱 산출물에서 제외하고 원본은 유지한다.
- [SIL OFL 공식 안내](https://openfontlicense.org/open-font-license-official-text/), [ExifTool 공식 자료](https://exiftool.org/), [Perl 라이선스 안내](https://dev.perl.org/licenses/). 최신 일반 안내와 현재 설치 버전의 원문은 구분한다.
- sharp는 수집한 **0.32.6/실제 vendor 8.14.5 파일**을 근거로 한다. 최신 sharp 설치 문서를 이 구버전의 바이너리 구성으로 간주하지 않는다.

## 조사 시점과 재현 비교

두 JSON의 gitHead/dirty는 **수집 직전**의 상태다. 파일 바이트는 작업 트리, 추적 목록·서브모듈 리비전은 index에서 읽는다. dirty이면 경고하되 수정 파일의 해시를 그대로 기록한다. 저장소 내부 출력은 docs/licenses 하위 폴더만 허용하고 심볼릭 링크 우회도 거부한다. 외부 임시 폴더를 쓸 수 있다.

현재 JSON은 고지 수집 구현을 반영한 깨끗한 b260ffe 커밋에서 임시 폴더로 먼저 수집한 뒤 복사했다. 이전 패키징 필터 스냅샷은 6e2b76b 조사 상태였다. PR #7의 이전 스냅샷은 fd3307b 조사 상태였으며 Git 이력에서 확인할 수 있다. 스냅샷을 보관한 후속 커밋의 HEAD와 같을 필요는 없다. 같은 조사 입력·상태에서 바이트 단위 재현을 검사한다. 후속 HEAD에서 비교할 때에는 gitHead/dirty와 파일 payload를 분리하고 sourceFiles 해시·목록도 함께 확인한다.

## 검사

독립 임시 폴더로 다시 생성한 9개 출력의 SHA-256이 모두 일치했다. TTF 메타데이터는 별도 fontTools 파서와 3종 전체 name 레코드를 대조해 일치했다(수집기 의존성은 아님). 선택한 설치 패키지 3개의 버전은 배포 lock과 일치하고, 고지·버전 자료 7개 복사본은 원본과 바이트/해시가 같다. OFL은 고정 커밋 원문과 일치한다. 앱 빌드·기동·실제 API·과금·패키징은 이 문서/수집기 변경에서 실행하지 않았다. UI 보완의 검증은 [별도 PR #6 기록](../reviews/2026-11-21-pr6-followup.md)이다.

PR #7 보완: 수집기 상태·경로 회귀 5/5, 깨끗한 조사 커밋에서 두 임시 폴더의 9개 산출물 일치. [처리표](../reviews/2026-11-21-pr7-followup.md).

[P0-04b1 실제 포함 범위·제외 전후](../validation/2026-11-21-package-manifest.md): 원본 자산 101개의 존재와 데스크톱 배포 포함 여부를 구분한다. 이제 폰트·Android용 DB·native 테스트 입력은 데스크톱 필터로 제외한다. 남은 라이선스 조건 이행은 P0-04b2다.

[번들·복사 런타임 고지 묶음](BUNDLE_NOTICES.md): 컴파일 목록·원문·미확인 8건과 실제 패키지 포함 검사를 다룬다. 역사적 root LICENSE를 복원했지만 앱 고유 저작권 표기는 미확인이다. 이 페이지의 P0-04a 조사 범위와 구분한다.
