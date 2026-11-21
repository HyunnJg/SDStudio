# 라이선스 조사 기록

확인일: 2026-11-21. [P0-04a 증거·원문·재현](licenses/README.md)을 추가했다. 아래는 확인한 파일의 표기와 남은 조사 범위다. 전체 의존성·자산·모델에 대한 검토 완료를 뜻하지 않는다.

| 대상 | 고정 리비전 | 확인한 증거 | 현재 처리 |
| --- | --- | --- | --- |
| SDStudio | `f2088add103ad683a31e0590448e6e5bb4d71556` | 루트 및 `release/app/package.json`의 `license: MIT`. 재귀 트리에서 독립 LICENSE/NOTICE/COPYING 파일은 찾지 못함 | 원본 이력·저자·크레딧 유지. 전문과 고지 자료는 추가 조사 |
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
| 기반 보일러플레이트 | `.erb/`, 루트 `package.json`의 electron-react-boilerplate 관련 정보 | 사용 리비전과 보존해야 하는 원 고지 |
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
