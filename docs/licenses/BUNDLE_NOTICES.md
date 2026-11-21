# P0-04b2 번들·복사 런타임 고지 묶음

2026-11-21 / 기준: PR #8 보완·병합 `58a6f4af05fbbb83c232bc2b4563aa654e64b057`.
구현·증거 조사: `b260ffefbc715f0f81ce5f0848a4f8786ebc37c0`.

## 원본 LICENSE 복원과 범위

초기 조상 `7091c9135bf0ddd29710e78f907906db96ea4975`의 LICENSE를 찾았다. 원문은 **Copyright (c) 2015-present Electron React Boilerplate**가 적힌 MIT 고지다. 같은 이력의 `fb2582c02ef184eac8a7b441075660d20151ab93`에서 삭제되었다. 두 커밋이 고정 원본 f2088의 조상임을 확인했다.

루트 LICENSE를 이 원문 그대로 복원했다. [고정 upstream 파일](https://github.com/sunho/SDStudio/blob/7091c9135bf0ddd29710e78f907906db96ea4975/LICENSE)과 SHA-256 `5e98c15fe806a18f79422d2cd0c4587129f4e03081b5ab4c030627d6f6840d68`까지 같다. Sunho Kim의 별도 저작권 문구/연도를 만들어 넣거나 ERB 표기를 바꾸지 않았다.

이는 역사적 ERB 고지를 보존한 것이다. SDStudio 고유 저작권 문구와 native ISC 전문은 아직 미확인이다. [APP_LICENSE_STATUS.md](APP_LICENSE_STATUS.md)를 고지 묶음에 함께 넣어 이 한계를 명시한다. 앱 package.json의 MIT 선언과 native의 ISC 선언도 그대로다.

## 수집 방식과 실제 포함

1. production webpack 컴파일에서 실제 모듈과 결합된 하위 모듈을 순회한다. main/preload 66개, renderer 77개 패키지 출현을 기록했다. externals는 별도다. 이 목록은 보수적 컴파일 목록이라 tree-shaken/orphan 모듈을 포함할 수 있으며 최종 코드 생존 비율을 추정하지 않는다.
2. 설치된 release/app 런타임 패키지와 내부의 이름/버전이 있는 package.json도 수집한다. 타입/예제 내장 메타데이터 2개도 포함하므로 이를 독립 npm 의존성 수로 읽지 않는다.
3. LICENSE/COPYING/NOTICE 계열 원문을 복사한다. README에 저작권·MIT 허가·보증 배제 문구가 모두 있으면 **README 전체를 원문으로** 보존하고 발견 기준을 기록한다. 선언 이름에서 라이선스 전문을 생성하지 않는다.
4. sharp/libvips와 ExifTool의 깊은 vendor 고지·버전 자료는 별도 보존한다. 다른 플랫폼 vendor 조건까지 해결했다고 표시하지 않는다.
5. build가 끝나면 묶음을 만들고 beforePack에서도 재생성한다. 누락된 컴파일 목록, 변경된 번들·lock·패키지 metadata는 재빌드를 요구한다. 실제 resources의 고지·사본 해시·번들 대응을 검사한다.

현재 244개 패키지/내장 메타데이터 레코드 중 **8개는 원문 파일 미확인**이다. 실제 원문 사본 250개(일부 패키지의 여러 고지와 vendor 자료 포함)를 보존했다. 이 개수는 고유 npm 이름 수나 전체 법적 조건 이행 개수가 아니다. [검사 결과와 누락 목록](../validation/2026-11-21-package-notices-check.json)을 참고한다.

패키지에는 다음 경로가 있다.

- `resources/LICENSE`: 복원한 역사적 ERB MIT 원문
- `resources/THIRD_PARTY_NOTICES/THIRD_PARTY_NOTICES.txt`: 읽을 수 있는 고지 묶음
- `resources/THIRD_PARTY_NOTICES/index.json`: 컴파일 입력·사본 해시·누락 목록
- `resources/THIRD_PARTY_NOTICES/APP_LICENSE_STATUS.md`: 앱/고유 모듈의 미확인 범위
- `resources/THIRD_PARTY_NOTICES/packages/`, `vendors/`: 원문 바이트 사본

생성물은 `.erb/generated/notices/`에 있고 Git에서 제외한다. 빌드 시 local 파일로 재생성하며 네트워크/새 의존성 설치는 없다. 전이 의존성을 추가했다는 뜻이 아니다. 생성기/검사기는 기존 webpack/electron-builder/asar 환경을 사용한다.

## 검증과 발견 사항

Linux x64 / Node 22.4.1 / Electron 26.6.10 / electron-builder 24.13.3.

| 검사 | 결과 |
| --- | --- |
| production main/preload·renderer 빌드 | 성공, 두 컴파일 목록 및 고지 묶음 생성 |
| 실제 webpack + 고지 테스트 | 3/3. 결합 하위 모듈·미사용 패키지 제외·README/내장 metadata·바이트 보존·재현, 번들 및 패키지 변조 후 거부 |
| 기존 증거 수집기 | 5/5. 깨끗한 구현 커밋에서 9개 재생성 출력 일치 |
| Linux directory package | 성공. publish=never·로컬 Electron·npmRebuild=false |
| 실제 패키지 고지 검사 | 필수 경로 4개·사본 250개 해시·번들 출현 143개와 복사 package.json metadata 112개 대응 확인 |
| tamper 검사 | 고지 사본을 바꾸면 실패, 원본 바이트 복구 뒤 통과 |
| 원문 필수 검사 | `--require-notice-files`는 누락 8건을 이유로 **의도대로 실패** |
| 실제 패키지 기동 | mock 17시나리오, 파일 백엔드의 기존 화면·위험 IPC 5종 거부, 원격 요청/렌더러 오류 0건 |
| 런타임 코드/데이터 | main/preload/renderer/style.css/data/db.csv가 PR #8 산출물과 동일 해시 |

첫 검사에서 electron-builder가 package.json의 scripts/bugs 등 비런타임 필드를 제거하는 것을 확인했다. 따라서 소스 package.json 전체 해시는 보존하되, 패키지의 대응 검사에는 name/version/license/author/repository의 identity 해시를 사용한다. 패키징 후 전체 JSON 바이트가 같다고 주장하지 않는다. 추가로 실제 산출물에 타입/예제 metadata가 포함되는 것을 발견하여 수집 범위를 넓혔다. 이를 무시하고 검사를 통과시키지 않았다.

기존 ASAR 논리 파일은 바뀌지 않았다. 새 ASAR 항목은 컴파일 목록 2개와 전체 빌드로 다시 생성된 main/preload 소스맵 2개다. 소스맵 정책은 이번에 변경하지 않았고 별도 용량 후보로 남아 있다. 물리 파일의 추가는 고지 자료이며 기존 일반 파일 중 바뀐 것은 ASAR 컨테이너뿐이다. [비교 요약](../validation/2026-11-21-bundle-notices.json)을 보관하고 전체 JSONL은 새로 커밋하지 않았다.

기동 보고서: [mock](../validation/2026-11-21-notices-mock-smoke.json), [파일 백엔드](../validation/2026-11-21-notices-file-smoke.json). Xorg dummy/loopback inspector 하네스·singleton 모의 조건은 [기존 패키지 검증](../validation/2026-11-21-package-manifest.md)을 따르며 ASAR 파일·OS sandbox는 유지했다. 강화된 릴리스 fuse 검사는 아니다.

## 재현

```sh
npm run test:bundle-notices
npm run test:licenses
npm run build
# 두 컴파일 결과가 이미 있으면 고지만 다시 수집
npm run licenses:bundle
# beforePack에서도 자동 생성
npx --no-install electron-builder --linux --dir --publish never \
  --config.directories.output=/tmp/sdstudio-package-notices \
  --config.npmRebuild=false --config.electronDist=node_modules/electron/dist
npm run package:check-notices -- /tmp/sdstudio-package-notices/linux-unpacked
# 현재 8건 때문에 실패하는, 누락 원문을 허용하지 않는 검사
npm run package:check-notices -- /tmp/sdstudio-package-notices/linux-unpacked --require-notice-files
# Linux X11
npm run smoke:package -- /tmp/sdstudio-package-notices/linux-unpacked
```

## 남은 범위

누락 8건(원문 파일 기준), SDStudio 고유 저작권 문구/native ISC 전문, compiler-generated 코드의 추가 귀속 여부, vendor 조건/LGPL 관련 소스·재링크, 다른 OS, 자산·태그 DB 출처/빈 DB 대체는 남아 있다. 누락된 내장 metadata가 상위 고지로 충족되는지도 개별 검토해야 한다. 이 도구는 **전체 재배포 승인이나 법적 적합성 검사기**가 아니다. 실제 계정/API·과금·공개 배포는 실행하지 않았다.
