# Windows 설치 실패 후 실험 도구 설치 분리

2026-11-22 (Asia/Seoul). 기준 PR15 head bcc8dc81a8f9a23313411d8b6be1c2df4ebcf9f3. 구현 0fd3cdb2f4c6fb9beb980958490bbd343b566ee2, 트리5dd4c8e01f25aa3b3c532f073d43fc79b3fc654e. 사용자 개인 경로·계정·로그 원문은 기록하지 않는다.

## 관찰과 변경 범위

사용자 Windows10/Node26.13.1/npm11.21.3/Python3.12.8/VS2026 환경의 npm install이 preinstall → src/native → 로컬 @electron/node-gyp10.2.0-electron.1에서 실패했다. VS18/Community를 unknown version으로 분류한다. 이것은 사용자 제공 로그로 확인한 원인이다. Python3.12/node-gyp9 문제도 저장소에 잠재하지만 **이번 로그의 실행기는10.2.0**이므로 이를 직접 원인으로 바꾸어 설명하지 않는다.

설치된 로컬 finder의 VS2026 인식 부재와 [공식12.1.0 지원 추가](https://github.com/nodejs/node-gyp/blob/main/CHANGELOG.md#1210-2025-11-12)를 대조했다. 전역 npm/node-gyp 변경만으로 그 로컬 Electron fork가 바뀐다고 안내하지 않는다. VS 재설치/개인 설정 삭제도 요구하지 않는다.

이번 수정은 전체 앱 빌드 도구를 임의 갱신하는 대신 **실험 창에 불필요한 앱 네이티브 빌드를 설치 경로에서 제외**한다. 별도 private 패키지의 의존성은 기존 루트 lock과 동일한 버전·resolved를 가진89개 패키지/루트 포함90레코드다. node-gyp/sharp/sdsnative/electron-builder/@electron/rebuild는 없다. install script는 Electron 바이너리 다운로드 하나뿐이다. 새 외부 소스를 복사하지 않았다.

## 실제 실행

| 검사 | 결과 |
| --- | --- |
| 독립 npm ci | Linux x64/호스트 Node24.22.3/npm11.19.1에서89패키지 설치 성공. Python/VS/C++ 빌드 호출 없음 |
| 새 도구 테스트 | 3/3: 잘못된 CLI 인자 거부, lock에 앱 네이티브 빌드 도구 없음, 실제 Electron의 독립 설치 경계 |
| 깨끗한 기동 | 루트 node_modules가 아예 없는 임시 체크아웃에 필요한 소스/화면만 복사. 독립 node_modules 외 npm 모듈 접근을 resolver hook으로 거부한 채 실제 창 기동 |
| 오프라인 경계 | 실제 Electron26.6.10/내장Node18.16.1, 상태 offline=true, 토큰IPC·run은OFFLINE, attempt 미소비/보관 폴더 비어 있음, 가짜 원본 appData에 새 폴더 없음 |
| 기존 연구 창 회귀 | 기존 test:nai-live:electron 5/5 통과. PNG/불량ZIP/HTTP오류/취소/offline 경로 유지 |

Electron 실기는 Linux Xorg dummy/TCP에서 실행했다. 디스플레이 없이 새 test 명령을 실행했을 때는2통과/실기1skip을 명시하고, 디스플레이를 붙인 뒤3/3을 별도로 확인했다. 기존 연구 창 회귀의 host runner는Node22.4.1이었으며 현재 호스트 npm11.19.1이 그 버전을 지원하지 않는다는 경고가 있었다. 이를 새로운 npm/Node 지원 조합이나 npm ci 재현 성공으로 표시하지 않는다. 독립 설치 성공 조합은 위24.22.3/11.19.1이다.

전체 앱 빌드·전체 tsc·패키징·다른 UI 스모크는 이번에 반복하지 않았다. Windows/macOS 및 사용자Node26의 실제 설치·기동, 전체 앱 npm install의VS2026 지원은 아직 미검증이다. 실제 토큰 사용/NovelAI 호출/지출은0이다.

## 사용자 실행

[DEVELOPMENT 명령](../DEVELOPMENT.md#1회-실호출-검증-도구-d-032)과 [tools 안내](../../tools/nai-validation/README.md)를 따른다. 루트 npm install을 다시 실행하거나 기존 의존성/lock을 지우지 않아도 된다. 키는 GUI에 직접 입력한다. 기존1회/수동 웹 비용·잔액 확인/비공개 보관·중지 정책은 D-032 그대로다.
