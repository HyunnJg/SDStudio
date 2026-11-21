# 제한된 메인 ZIP·PNG 응답과 PR #12 후속

2026-11-21 (Asia/Seoul). 시작 `ab286f2`(PR #12 병합). 의견 보완 `8ea3178cacbfc06269ca2ee422dce82c06678df8`, 응답 구현 `b2313ed2e36deb2952a409f39e2ff8c6fd0e13b1`(트리 `6ff72bc0b517ad1d6d38e82cfe3845e5507cb011`).

[PR #12 처리](../reviews/2026-11-21-pr12-followup.md), D-029/030에 따라 V3 로그인/재시작 안내를 보완한 뒤 메인 sendImage의 응답 한도를 구현했다. **모델 바인딩·생성 IPC/대기열 연결·새 프로젝트 저장은 미완료**다. 실제 NovelAI 계정/인증·생성 API 호출·과금은 0이다.

## 정책과 보존 경계

- ZIP 64 MiB, 해제 PNG 32 MiB, 최대 16,777,216 픽셀은 로컬 자원 한도다. 전체 프로세스 메모리 상한이라는 뜻은 아니다. 입력 사본·스트림 청크와 최종 연결 버퍼의 메모리도 필요하다.
- 단일 PNG 엔트리의 STORE/DEFLATE·일반/스트리밍 descriptor만 허용한다. 압축 해제 전 디렉터리/로컬 헤더·이름/플래그·크기/CRC 대응을 확인하고, 비동기 zlib 출력에도 실제 크기 한도를 적용한다. 이름은 ASCII 상대 경로이며 파일시스템에 추출하지 않는다.
- ZIP64/암호화/분할 볼륨/접두 실행 파일·다중/부가 엔트리·디렉터리 엔트리·symlink·허용 외 압축 방식은 거부한다. 이 제한 형식이 실제 NovelAI 응답을 모두 지원한다고 확정하지 않았다. 실제 서버 응답이 다르면 오류로 남기고 근거를 확보해 범위를 바꾼다.
- ZIP CRC 및 PNG 시그니처·청크 CRC·IHDR/IDAT/IEND 구조·기본 비트 깊이/색상 타입·픽셀 한도를 검사한다. PNG 픽셀/IDAT를 완전히 디코딩해 이미지의 의미나 메타데이터의 신뢰성을 검증한 것은 아니다. 원본 바이트를 반환하며 RGBA/메타데이터를 재인코딩하지 않는다.
- sendImage는 기존 send와 해제에 하나의 기한/AbortSignal을 사용한다. 응답 후 실패/취소/시간 초과는 mayHaveReachedServer=true로 남기고 자동 재시도하지 않는다. 2xx MIME 거부 RESPONSE_FORMAT과 비 2xx HTTP_ERROR를 분리했다. 원시 서버 본문·토큰·프롬프트·파일명은 오류에 넣지 않는다.
- 기존 렌더러 readPreviewPNGZip은 오프라인 fixture용으로 유지한다. 이 메인 모듈은 내부 전송 함수까지 구현한 상태로, 실제 앱의 생성 경로에는 아직 연결하지 않았다.

## 실행 결과

호스트 Node 22.4.1, 실제 Electron 26.6.10/내장 Node 18.16.1, Linux x64. 의존성/native 설치를 재사용했다. 새 npm ci/깨끗한 체크아웃 재현은 반복하지 않았다. 게시 전 동일한 운영 소스 바이트로 빌드했고 전체 저장소 tsc와 webpack transpileOnly 빌드를 구분한다. [요약 JSON](2026-11-21-image-response-summary.json), [실기 보고서](2026-11-21-image-response-runtime.json).

| 검증 | 결과 |
| --- | --- |
| test:nai-response | 12/12: STORE/DEFLATE/descriptor, RGBA/metadata 바이트 보존, 입력 사본, 선언/실제 크기 위조, CRC/PNG 손상/종결·픽셀 한도, 다중/위험 엔트리, 헤더 불일치/ZIP64/extra/trailing data, 취소/기한, sendImage의 서버 처리 가능성·재시도 없음 |
| test:network-mode | 10/10. 기존 9건과 V3 실행 종료 중·V3 예약·작업실 예약별 안내 |
| 기존 단위·합성 회귀 | nai-main 19, offline 11, contract 10, auth-ui 3, workspace 14, identity 3, profile 13, startup 4 통과 |
| 범위 타입·린트 | 신규 decoder/transport/shared type/restartPreparation/인증·모드 모달 엄격 검사 통과. 전체 저장소의 기존 TS2688을 해결한 것은 아님 |
| 실제 Electron | 인증/전송/응답 1테스트·10체크. 운영 모듈을 ts-node로 하네스에서 불러 실제 net.request의 루프백 응답 처리. PNG 원본 일치와 잘못된 응답 거부, 네트워크 차단/쿠키 배제/리다이렉트 유지 |
| build/package | production main/preload/renderer·고지 생성 및 Linux directory package 성공. --publish never, npmRebuild=false, 기존 Electron/native 재사용. 설치/서명/릴리스 없음 |
| 실제 패키지 토큰 UI | 10체크. 새 토큰만 보관해도 V3 로그인 성공으로 표시하지 않음, V3 이메일/비밀번호·평문 경고, 기존 복구/삭제/390px/포커스 동작 |
| 실제 패키지 작업실 | 기존 17시나리오 + 오프라인 토큰 모달 3체크 통과 |
| 실제 native 재시작 | 서로 다른 3 PID·2번 relaunch. V3 0건/진행 promise의 구체적 차단 안내, 저장 실패 시 중단·저장 후 재시작·온라인/오프라인 복귀·합성 원본 파일/ASAR 불변 |
| 실제 고지 검사 | 경로/사본·번들 해시 대응 통과. 고지 레코드 244, 미해결 원문 8건 유지 |

새 응답 구현 자체의 실제 Electron 검사는 **하네스가 운영 소스 모듈을 불러 수행**했다. 패키지 스모크가 실제 생성 IPC를 통해 이 경로를 호출한 것은 아니다. 모든 온라인 UI 검사도 추가 하네스의 외부 차단으로 원격 요청을 막았다. 실제 서비스/계정 호출 없이 루프백 요청 4건을 사용했다. 세션 한정 합성 토큰과 basic_text 영구 보관 거부만 확인했으며 정상 OS 키링 성공은 미검증이다.

## 재현

```sh
npm run test:nai-response
npm run test:nai-main
npm run test:network-mode
npm run test:nai-main:electron
npm run build
npx electron-builder --linux --dir --publish never --config.npmRebuild=false --config.electronDist=node_modules/electron/dist --config.directories.output=/tmp/sdstudio-bounded-response-package
npm run smoke:package -- /tmp/sdstudio-bounded-response-package/linux-unpacked auth
npm run smoke:network-mode -- /tmp/sdstudio-bounded-response-package/linux-unpacked
```

Electron 창 검사는 X11이 필요하고 이 환경에서는 Xorg dummy/TCP를 제공했다. 실제 패키지 검사는 loopback inspector 하네스를 주입하고 Unix 소켓 제한 때문에 단일 인스턴스 잠금만 모의 처리했다. native relaunch 자체는 실제 Electron에 위임하며 앱 아카이브는 바꾸지 않는다. Windows/macOS·종료 취소 복구·실제 키링·실제 서버 ZIP 호환/계정 생성은 미검증이다. 이번 문서 커밋은 하네스 결과의 내장 Node 버전과 총 루프백 요청 수 표기도 정리했다.

## 근거와 다음 범위

- 2026-11-21 [공식 Image API 스키마](https://image.novelai.net/docs/doc.json)를 열어 model의 string 타입과 현재 구조를 다시 확인했다. 모델별 API ID enum/action/params_version 기본값은 확정하지 못했다. 타사 ID/기본값을 공식 근거로 채택하지 않았다.
- [PKWARE ZIP APPNOTE 6.3.10](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT), [W3C PNG](https://www.w3.org/TR/png-3/)를 형식 확인에 참고했다. 외부 소스 코드를 가져오지 않았다. zlib stream API는 설치된 Node 타입과 실제 Electron Node 18.16.1 동작을 확인했다. 최신 Node의 새 ZIP/CRC API를 사용하지 않는다.
- 다음은 모델별 요청 근거/바인딩과 새 프로젝트 저장·복구다. [최소 실호출 계획](../NAI_LIVE_VALIDATION.md)은 계정·요청 수·Anlas 상한/중지 조건 확정 전 실행하지 않는다.
