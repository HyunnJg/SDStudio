# 라이선스 조사 기록

확인일: 2026-11-20. 아래는 확인한 파일의 표기와 남은 조사 범위다. 전체 의존성·자산·모델에 대한 검토 완료를 뜻하지 않는다.

| 대상 | 고정 리비전 | 확인한 증거 | 현재 처리 |
| --- | --- | --- | --- |
| SDStudio | `f2088add103ad683a31e0590448e6e5bb4d71556` | 루트 및 `release/app/package.json`의 `license: MIT`. 재귀 트리에서 독립 LICENSE/NOTICE/COPYING 파일은 찾지 못함 | 원본 이력·저자·크레딧 유지. 전문과 고지 자료는 추가 조사 |
| `src/native` | 위와 같음 | `src/native/package.json`의 `license: ISC` | 상위 패키지 MIT와 구분. 이 모듈을 MIT로 바꾸지 않음 |
| BiRefNet 서브모듈 | `15a114c46349f26866eeddc76387053394be2a0a` | `LICENSE`: MIT, 저작권 표기 ZhengPeng (2024) | 코드 고지 확인. 모델 가중치·데이터·배포 자산은 별도 조사 |
| capacitor-background-mode 서브모듈 | `dc536b991ef441425ffa2f5e71c2aa90b1daf231` | `package.json`의 `license: MIT`. 재귀 트리에서 독립 라이선스 파일은 찾지 못함 | 정확한 고지 자료 추가 조사 |
| NAI-Auto-Generator | `e76894df8e51d2edec3178cdef61e4ad8e570d95` | 조회한 재귀 트리에서 LICENSE/NOTICE/COPYING 파일은 찾지 못함 | 이번 작업에 코드·자산 미도입. 별도 확인 없이 복사·통합하지 않음 |

트리 검사는 파일명 탐색이다. README나 소스 주석 등에 있는 모든 권리 표기를 조사했다는 뜻은 아니다. 라이선스 전문이 없다고 확인된 패키지 표기까지 없다고 단정하지 않는다.

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
