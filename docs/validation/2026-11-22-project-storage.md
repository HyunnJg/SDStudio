# 독립 프로젝트 저장·복구 검증 — 2026-11-22

- 기준: PR #17 병합 `30d238181d7c4d48262a40e2d1c8be04554ffd07`.
- 런타임: `a7735f982f7a5fba100d866bf0967149a95cd967`, tree `e81a111f3e10e9f26ab814dc2bbe6c4f94f419c0`.
- 범위: D-037/038. [형식/복구·후속 화면](../PROJECT_STORAGE.md), [상세 합성 보고서](2026-11-22-project-storage.json).
- 데이터: 합성 초안·V3 모양의 fixture·가짜 TOKEN/config·직접 만든 RGBA/metadata PNG. 실제 계정·토큰·이미지·잔액은 입력받지 않았다. 추가 실제 API 호출 0회.

## 실행 결과

| 검사 | 결과 | 의미 |
| --- | --- | --- |
| test:project | 13/13 | 별도 형식, 미완성 문자열·시드0·3씬·격자 보존, 불변 이력/리비전 충돌, rename 실패, 손상/미지원 보존·복사 복구, PNG 바이트/CRC/해시, 경로/링크/잠금, JSON/UTF-8/한도, IPC 신뢰 검사·V3 fixture 불변 |
| test:nai-main | 36/36 | 기존34 + 빈/3바이트 본문 및 raw send AST tripwire 2건 |
| test:nai-response | 19/19 | 기존 ZIP/PNG·로컬 재검사 회귀. 새 직접 PNG 검사는 project 테스트에서도 사용 |
| test:offline | 11/11 | 기존 네트워크 진입점/차단 정책 유지 |
| test:workspace | 14/14 | 기존 draft·메모리 대기열 회귀 |
| test:nai-contract | 10/10 | 기존 오프라인 투영 경계 유지 |
| 프로젝트 Electron | 1/1, 6체크 | sandbox/contextIsolation의 실제 컴파일 preload→신뢰 프레임 IPC, 오프라인 저장·충돌/접근 거부·PNG 포함 복사 복구·새 store에서 읽기 |
| 인증/전송 Electron | 1/1, 13체크 | 새 preload에서도 기존 토큰/오프라인/defaultSession·미분류/부재 MIME·원본 PNG·리다이렉트 경계 유지 |
| 범위 엄격 타입/린트·구문/포맷 | 통과 | schema/store/IPC/preload와 PNG 검사 범위. 전체 tsc는 기존 TS2688 문제로 실행 범위를 넓히지 않음 |
| 메인·렌더러 빌드/고지 수집 | 통과 | 코드 변경 후 main을 다시 빌드했고 244 레코드·미해결8건 유지 |

단위 103/103, 실제 Electron 2/2이며 모두 skip 0이다. 프로젝트 하네스의 원격 허용/차단 요청·렌더러 오류는 모두0건이다. 인증 하네스는 원격 허용0건, 동일 defaultSession의 거부1건과 루프백7건이다. 두 하네스는 임시 appData 밖 원본 위치에 파일을 만들지 않는 검사도 통과했다.

프로젝트 하네스는 **검사 전용 Electron 진입점 + production 컴파일 preload**를 사용한다. 실제 App.tsx의 저장 화면이나 패키지 전체 실행, 실제 프로세스 재시작/종료 저장을 검사한 것은 아니다. 새 store 인스턴스로 재개한 읽기와 별도 창의 IPC 거부를 확인했다. V3 검사는 합성 파일 해시/JSON 불변이며 실제 Session.fromJSON→편집 UI→저장 회귀를 새로 수행한 것은 아니다.

## 재현 조건

호스트 Linux x64·Node22.4.1, Electron26.6.10/내장 Node18.16.1. 임시 Xorg dummy(TCP loopback + cookie 인증)로 실제 창을 만들었다. npm11.19.1은 Node22.4.1 비호환 경고가 있었으므로 권장 설치 조합으로 제시하지 않는다. 단위/타입/린트는 Node 직접 명령으로 실행했다. 새 npm ci나 의존성 업그레이드는 하지 않았다.

```sh
npm run test:project
npm run test:nai-main
npm run test:nai-response
npm run test:offline
npm run test:workspace
npm run test:nai-contract
# Linux X11 + 컴파일 preload 필요
npm run test:project:electron
npm run test:nai-main:electron
npm run build
```

이 환경에서는 위 단위 파일들을 하나의 node --test 실행으로 묶었다. 빌드는 build:main/build:renderer 병렬 실행 후 고지 수집, 최종 메인 변경 뒤에는 main과 고지 수집을 다시 실행했다. Electron은 두 하네스를 순서대로 실행했다. 최초 합성 HTML에 CSP가 없어 개발 보안 경고를 오류로 잡은 것은 fixture에 default-src 'none'을 적용해 고쳤으며 최종 rendererErrors=0이다.

미실행: Windows/macOS·ACL·VS2022 병행 설치·전체 Windows npm ci/네이티브 빌드, 전원 차단 내구성, 새 패키징, 실제 V3 UI 회귀, 프로젝트 저장/열기·미저장 편집·종료/재시작 UI 연결, 실제 모델/생성/대기열 저장·복구. 파일/리비전 정책을 구현했다는 것이 모든 플랫폼의 원자성/복구를 증명하는 것은 아니다.
