# 라이선스 조사 기록

확인일: 2026-11-21. [P0-04a 증거·원문·재현](licenses/README.md)을 추가했다. 아래는 확인한 파일의 표기와 남은 조사 범위다. 전체 의존성·자산·모델에 대한 검토 완료를 뜻하지 않는다.

| 대상 | 고정 리비전 | 확인한 증거 | 현재 처리 |
| --- | --- | --- | --- |
| SDStudio | `f2088add103ad683a31e0590448e6e5bb4d71556` | 루트 및 `release/app/package.json`의 `license: MIT`. 재귀 트리에서 독립 LICENSE/NOTICE/COPYING 파일은 찾지 못함 | 조상 7091c91에서 ERB MIT 원문을 찾아 동일 바이트로 복원. 앱 고유 저작권 문구는 여전히 미확인. 원본 저자·크레딧 유지 |
| `src/native` | 위와 같음 | `src/native/package.json`의 `license: ISC` | 상위 패키지 MIT와 구분. 이 모듈을 MIT로 바꾸지 않음 |
| BiRefNet 서브모듈 | `15a114c46349f26866eeddc76387053394be2a0a` | `LICENSE`: MIT, 저작권 표기 ZhengPeng (2024) | 코드 고지 확인. 모델 가중치·데이터·배포 자산은 별도 조사 |
| capacitor-background-mode 서브모듈 | `dc536b991ef441425ffa2f5e71c2aa90b1daf231` | `package.json`의 `license: MIT`. 재귀 트리에서 독립 라이선스 파일은 찾지 못함 | 정확한 고지 자료 추가 조사 |
| NAI-Auto-Generator | `e76894df8e51d2edec3178cdef61e4ad8e570d95` | 조회한 재귀 트리에서 LICENSE/NOTICE/COPYING 파일은 찾지 못함 | 이번 작업에 코드·자산 미도입. 별도 확인 없이 복사·통합하지 않음 |

트리 검사는 파일명 탐색이다. README나 소스 주석 등에 있는 모든 권리 표기를 조사했다는 뜻은 아니다. 라이선스 전문이 없다고 확인된 패키지 표기까지 없다고 단정하지 않는다.

## 독립 검토로 보강한 미확인 항목

다음 파일·다운로드 경로의 존재는 소스로 대조했다. 출처와 실제 재배포 조건은 이번 문서 변경에서 조사 완료하지 않았다.

| 대상 | 확인한 위치 | 남은 확인 |
| --- | --- | --- |
| 태그 DB | `src/native/db.csv`, `assets/db.txt`, `release/app/data/db.csv` | 원 데이터·변환 과정·고지 조건. init()이 db.csv를 필수로 읽으므로 배포에서 제외할 경우 대체 데이터 또는 빈 DB로 기동할 경로도 필요. 배포 DB와 assets/db.txt 해시는 같고 native DB는 다름. 형식만으로 허용 판정 금지 |
| NotoSans 폰트 3종 | `assets/fonts/NotoSans-{Regular,Bold,Italic}.ttf` | 메타데이터에서 2022 Noto Project Authors / 2.013 / OFL 1.1 확인. 저작권과 일치하는 공식 고정 커밋 OFL.txt를 assets/fonts에 원문 추가. 원 배포본 취득 이력·바이너리 대조는 남음 |
| 기반 보일러플레이트 | `.erb/`, 루트 `package.json`의 electron-react-boilerplate 관련 정보 | 초기 조상 7091c91의 ERB MIT 고지 복원·배포 포함. 세부 차용 범위는 추가 확인 |
| 이미지·아이콘·예제 | 루트 이미지, `assets/`, `images/`, `examples/` | 파일별 출처·조건·배포 포함 여부 |
| npm/Python 의존성 | 루트·`release/app`·`src/native` package.json, `src/localai/requirements.txt` | 실제 설치 리비전 확정 후 직접·전이 의존성의 고지 자료 수집. `sharp`, `exiftool-vendored` 등 동봉 바이너리의 LICENSE/COPYING은 패키지 메타데이터와 별도 확인. Linux sharp/libvips 고지·버전과 ExifTool wrapper/본체 고지를 원문 수집했으나 조건 이행·다른 플랫폼·전수 검토는 남음 |
| 로컬 AI 배포 바이너리·가중치 | `LocalAIService.ts`의 Hugging Face ZIP 및 BiRefNet quality 다운로드 | 각 다운로드 산출물의 출처·조건·포함 의존성. BiRefNet 코드의 MIT 표기와 별도 취급 |

검토자는 태그 DB 출처와 폰트의 통상 라이선스를 추정했지만, 그 추정을 이 파일들의 확인 결과로 옮기지 않았다.

## 증거 링크

- [SDStudio package.json](https://github.com/sunho/SDStudio/blob/f2088add103ad683a31e0590448e6e5bb4d71556/package.json)
- [배포 package.json](https://github.com/sunho/SDStudio/blob/f2088add103ad683a31e0590448e6e5bb4d71556/release/app/package.json)
- [네이티브 package.json](https://github.com/sunho/SDStudio/blob/f2088add103ad683a31e0590448e6e5bb4d71556/src/native/package.json)
- [고정 서브모듈 목록](https://github.com/sunho/SDStudio/blob/f2088add103ad683a31e0590448e6e5bb4d71556/.gitmodules)
- [BiRefNet LICENSE](https://github.com/sunho/BiRefNet/blob/15a114c46349f26866eeddc76387053394be2a0a/LICENSE)
- [백그라운드 모듈 package.json](https://github.com/sunho/capacitor-background-mode/blob/dc536b991ef441425ffa2f5e71c2aa90b1daf231/package.json)
- [NAI-Auto-Generator 조사 리비전](https://github.com/DCP-arca/NAI-Auto-Generator/tree/e76894df8e51d2edec3178cdef61e4ad8e570d95)

## 새 코드를 도입할 때 기록할 내용

프로젝트 URL, 커밋/태그, 가져올 파일, 라이선스 전문 위치, 보존할 저작권·NOTICE, 변경 내용, 새 의존성과 자산을 기록한다. 기능 아이디어를 자체 구현하는 경우에도 참고한 프로젝트와 독립 구현 범위를 구분한다.

다른 오픈소스 후보는 아직 선정하지 않았다. MIT·BSD·Apache 등 이름만 보고 도입 완료로 표시하지 않고 실제 가져올 리비전과 파일을 확인한다. NovelAI의 UI 사용 흐름 참고와 공식 서비스의 코드·자산 재사용도 구분한다.


## P0-04a 수집과 남은 P0-04b

추적 자산 101개와 lock 3개의 선언·직접 의존성을 목록화했다. Linux 설치 고지·버전 자료 7개와 패키지 버전을 해시로 보존했고 폰트는 파일 내 name 레코드를 별도 파서와 대조했다. 수집 결과는 전체 배포 허용 목록이 아니다.

P0-04b는 원본/네이티브/배경 모듈/보일러플레이트의 정확한 고지, 태그 데이터·그림체/아이콘/예제 출처, 전이 의존성 전수 고지, LGPL 구성의 소스/재링크 조건, ExifTool 본체 및 Windows exe, 로컬 AI 바이너리·가중치와 실제 패키징 manifest를 다룬다. 출처가 끝내 확인되지 않는 자산의 제외·대체는 기능/기동 영향까지 별도 결정한다.


## P0-04b1 실제 포함 범위 정리

[전후 manifest·기동](validation/2026-11-21-package-manifest.md)을 확보했다. 데스크톱은 data/db.csv를 사용하고 Android는 assets/db.txt를 import한다. native/test.js가 읽는 src/native/db.csv도 file: sdsnative 패키지 안에 실제 포함되어 있었으므로 배포 대상이 아니라고 단정하지 않는다.

데스크톱 필터로 미사용 fonts 폴더(TTF/OFL), assets/db.txt와 선언 파일, sdsnative/db.csv/test.js를 제외했다. 원본은 저장소에 남고 필수 data/db.csv는 그대로다. 전체 P0-04b의 나머지는 P0-04b2다. 빈 DB 기동·자동완성 비활성 경로, 남은 데이터/이미지·바이너리 출처와 조건, 다른 OS·실제 배포 조건 확인은 여전히 필요하다.


## P0-04b2 고지 자동수집·배포 포함

[생성·범위·검사](licenses/BUNDLE_NOTICES.md)를 추가했다. 컴파일 모듈(결합 자식 포함)과 설치된 복사 런타임/내장 metadata에서 244레코드를 수집하고 원문 사본 250개를 보존했다. resources/LICENSE와 THIRD_PARTY_NOTICES 묶음의 실제 포함 및 해시·번들 대응을 확인했다. webpack 주석 파일만으로 전수 고지를 대신하지 않는다.

LICENSE는 초기 ERB MIT 원문 복원이며 Sunho Kim의 새 저작권 문구를 작성한 것이 아니다. APP_LICENSE_STATUS와 index에 그 한계 및 원문 누락 8건을 남겼다. 원문 필수 검사는 현재 실패하며 이 결과를 완료로 표시하지 않는다. compiler-generated 코드의 추가 귀속, native ISC 전문·앱 고유 표기, 자산/DB·vendor 조건과 다른 플랫폼은 여전히 남는다.


2026-11-24 D-050: 제품 sharp0.35.5/libvips8.18.7로 갱신했다. @img/sharp-libvips 플랫폼 패키지의 README.md 라이선스 표와 versions.json을 고지 증거에 추가하고 실제 패키지 사본 해시를 확인한다. 이전 sharp/vendor 경로는 해당 과거 설치에 대한 증거이며 새 버전에 소급 적용하지 않는다. Linux/Windows 플랫폼별 패키지의 실제 설치/산출물 기준으로 수집하며 전이 라이선스 조건 이행을 완료했다고 주장하지 않는다. [범위](RUNTIME_MODERNIZATION.md).

## D-056 PNG 메타데이터 형식 참고

NovelAI/novelai-image-metadata `3428907ac7183d7e36d7cc39e8f46f6f35ce99c1`의 nai_meta.py와 LICENSE(MIT, Copyright(c)2023NovelAI)를 읽어 알파 LSB 프로토콜을 확인했다. 외부 파일/코드/자산/의존성을 도입하지 않고, 이 저장소의 기존 CRC와 Web API로 독립 구현했다. [참고 범위](PNG_METADATA_IMPORT.md#공식-근거와-독립-구현). 기존 라이선스 미확인 항목을 해소한 작업은 아니다.

## D-079 Windows 설치본의 잔여 고지

`7d2bd70`에서 Windows 번들/복사 런타임 고지 원문을 찾지 못한 7건 중 6건을 정리했다. 기존 고지는 그대로 보존한다.

| 항목 | 확인 및 처리 |
| --- | --- |
| `@react-dnd/invariant@4.0.2`, `@react-dnd/shallowequal@4.0.2` | npm이 기록한 gitHead `641fd36c130e42c3cf08987924151efa1452bca7`의 `packages/util-invariant`, `packages/util-shallowequal`과 루트 MIT 고지를 확인했다. 두 패키지 고지에 동일 원문을 포함한다. [원본 고지](https://github.com/react-dnd/react-dnd/blob/641fd36c130e42c3cf08987924151efa1452bca7/LICENSE) |
| `react-dnd-preview@8.1.2` | npm gitHead `c9d018e523f5ad98dc4fe1606b3a08c181b115c8`의 `packages/react-dnd-preview`와 루트 MIT 고지를 확인했다. [원본 고지](https://github.com/LouisBrunner/dnd-multi-backend/blob/c9d018e523f5ad98dc4fe1606b3a08c181b115c8/LICENSE) |
| `browserify-zlib`, `is-gzip` | 미사용 직접 의존성 `gunzip-maybe`를 제거하면서 두 패키지도 런타임 트리에서 빠졌다. 구 세션 아카이브가 사용하는 `tar-fs`는 유지한다. |
| `batch-cluster/types/chai-withintoleranceof` | 테스트용 타입 선언과 그 package.json 두 파일을 설치 대상에서 제외했다. ASAR 검사는 실제로 복사된 런타임 package.json을 색인과 대조한다. |
| `src/native` | 태그 검색 모듈의 package.json에는 ISC 선언이 있으나 해당 모듈의 원문 고지를 확인하지 못했다. 미해결로 유지한다. |

## D-089 Windows x64 배포 후보

### 태그 검색 데이터의 출처 대조

`release/app/data/db.csv`의 Git blob은 `8577d615dafb5ce67e2ebef1e11a7820030a6c92`다. 원본 SDStudio의 `f13d784`에서 처음 들어온 앞 122,870행은 tagcomplete 리비전 `1d8d9f6`의 CSV 100,000행으로 재현된다. 두 파일을 CSV로 읽고, 원자료의 이름과 별칭에서 밑줄을 공백으로 바꾼다. 각 이름에 대해 별칭마다 `[별칭, 분류, 횟수, 이름]` 행을 먼저 만들고 `[이름, 분류, 횟수, "null"]`을 붙이면 행 순서와 네 필드 값이 모두 일치한다. 원자료 SHA-256은 `805ed20a56d7f5a562e2c4e2a70491725100a28f37d48dd0daf19e2c9ffd7031`이다. [대조한 CSV](https://github.com/DominikDoom/a1111-sd-webui-tagcomplete/blob/1d8d9f64b5aaaa0b2b9cbebaa5fd45a48b193ba6/tags/danbooru.csv) · [원자료 갱신 논의](https://github.com/DominikDoom/a1111-sd-webui-tagcomplete/issues/274)

해당 리비전의 MIT 고지 원문을 `LICENSES/tagcomplete-MIT.txt`로 동봉했다. 원문과 패키지 사본의 SHA-256은 `c1532c29734187eddd3948321379fa95ba79191bc3cb41d2787d7dff6e5913b5`다. 나머지 1,862행은 모두 첫 필드에 한글이 있는 별칭이다. 원본 SDStudio가 1,892행을 추가한 뒤 수정한 이력까지 확인했다. 이 별칭들의 작성 출처와 별도 재배포 조건은 미확인이다. [MIT 원문](https://github.com/DominikDoom/a1111-sd-webui-tagcomplete/blob/1d8d9f64b5aaaa0b2b9cbebaa5fd45a48b193ba6/LICENSE) · [별칭 추가](https://github.com/sunho/SDStudio/commit/f2268e61c2f3732d2de83c2bd5b51b9e30f0bfef) · [후속 수정](https://github.com/sunho/SDStudio/commit/0ab722287f431ce505847ec20a8a046f895fb5f3)

### 설치 후보의 파일 검사

2026-11-28. 패키지에서 원문 사본 200개와 복사된 런타임 패키지 메타데이터 48개를 검사했다. Electron의 LICENSE와 Chromium의 LICENSES.chromium.html도 설치된 Electron 배포본과 바이트 단위로 대조한다. 고지가 손상된 검사용 ASAR 시나리오가 실패하는 것을 확인했다. NSIS에서 추출한 파일 1,024개가 디렉터리 패키지와 일치했다.

새 소개 화면은 직접 그린 등대 예시와 격리된 오프라인 작업실을 촬영한 것이다. 새 데스크톱 아이콘은 이 포크에서 작성했다. 패키지의 외부 assets에는 창 아이콘 한 개가 들어간다. 수동 태그 검색 테스트와 `prompt-sync`는 배포 ASAR에 없다.

고지 색인의 미해결 원문은 `src/native` 1건이다. 이 저장소의 native 경로에서 원문·저작권 문구와 과거 LICENSE 경로를 다시 찾아봤으나 ISC 선언 외의 원문을 확인하지 못했다. 앱 자체의 저작권 표기, 동봉 태그 DB의 원자료와 재배포 조건, 바이너리 공급자의 조건은 별도 확인 대상이다.

원본 고지 파일은 `LICENSES/` 아래에 저장한다. 수집기는 위 버전에 한해 SHA-256을 대조하고 사본의 해시를 설치본 색인에 기록한다. Windows에서 고지 파일·vendor 증거 200개를 검증했다. SDStudio 고유 표기, DB·이미지 출처, ExifTool과 libvips 배포 조건은 기존 별도 검토 항목이다.
