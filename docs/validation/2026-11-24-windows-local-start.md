# Windows 로컬 전체 앱 기동 — 사용자 전달 기록

2026-11-24 (Asia/Seoul). 출처: 사용자가 제공한 ‘젬클 의견.md’의 로컬 Codex 결과 발췌. 이 Linux 작업 환경에서 Windows를 재현하거나 로그/파일 원본을 직접 검사한 기록이 아니다. 사용자 경로·키·이미지는 수집하지 않았다.

## 전달된 결과

- main 전환·git pull --ff-only 후 HEAD e36b94f. 기존 package-lock.json 로컬 수정(32줄 삭제)을 보존했고 앱 소스·의존성 선언을 바꾸지 않았다. 그 lock 차이 원문은 이 체크아웃에 전달되지 않아 자동 이식하지 않는다.
- 전역 Node26.13.1은 유지했다. 공식 SHA-256 목록과 대조한 Node22.4.1 Windows x64 ZIP을 ignore되는 node_modules/.sdstudio-runtime 아래에 두고 activate.ps1로 현재 PowerShell만 Node22/npm10.8.1을 사용했다.
- 전체 앱 Electron 실행 파일이 없어 기존 연구 도구의 같은26.6.10 dist를 복사하고 path.txt를 복구했다. release/app ci는 --ignore-scripts로 실행한 뒤 sharp0.32.6만 재빌드했고 link-modules로 연결했다.
- 로컬 build-tools 경로에 node-gyp12.1.0을 설치했다. 전달 기록의 출처는 https://github.com/nodejs/node-gyp/releases/tag/v12.1.0 이며 설치 폴더 LICENSE를 유지했다. 앱 의존성/배포물에 추가하지 않았다. 이 도구의 호스트는 기존 Node26이고, Electron26.6.10 헤더 대상으로 VS2026/Python3.14.3에서 src/native를 컴파일했다. 기존 자동 Electron rebuild 경로를 전역 교체하지 않았다.
- Node22에서 sharp/native 로드, build:dll, production build, npm start 개발 서버·preload·main·실제 Windows 창의 새 작업실/API 토큰 버튼·오프라인 배지를 확인했다. 고지는244패키지/기존8건 미해결이다. 정상 포크 프로필을 사용했고 로그인·토큰 입력·실제 생성 요청은0회다.

| 역할 | 전달된 도구 조합 |
| --- | --- |
| 전체 앱 개발 실행 | Node22.4.1 / npm10.8.1 |
| 새 native 빌드 도구 호스트 | Node26.13.1 / node-gyp12.1.0 |
| native 대상 | Electron26.6.10 헤더 |
| C++/Python | VS2026 / Python3.14.3 |

## 해석과 남은 범위

이 결과는 VS2026에서도 새 탐지 도구를 이용한 native 컴파일 경로가 있음을 보여주는 사용자 보고다. Node26으로 앱 전체/기존 자동 재빌드가 지원된다는 증명이나, VS2022 병행 설치가 반드시 필요하다는 근거가 아니다. 앞서 제안했던 VS2022 설치는 선택지로만 남기고 정상 기동 환경에 추가 설치를 요구하지 않는다.

깨끗한 루트 npm ci·기존 자동 재빌드·Windows 패키징·단위/전체 타입검사·새 UI 실제 계정 생성은 이 로컬 기록에서 미실행이다. 기동 당시 소스 e36b94f는 PR28 이전이므로 V5 실계정 성공으로 확대하지 않는다. 전역 버전/기존 lock/정상 실행 환경은 보존한다. node_modules 안의 전용 런타임은 루트 재설치로 사라질 수 있으므로 작동하는 환경을 다시 지우는 복구 절차를 기본 안내로 쓰지 않는다.

Node/Electron 현대화는 이후 독립 작업에서 개발 호스트·Electron 내부 Node·native ABI/빌드 도구 지원 범위를 함께 갱신한다. 이 기록을 재현 가능한 새 Windows 설치 스크립트로 오인하지 않는다.
