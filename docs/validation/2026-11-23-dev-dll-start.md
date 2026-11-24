# 개발 DLL 누락 복구와 실패 로그

작성일: 2026-11-23 (Asia/Seoul). 기준 `e36b94f0d92f983e515a218076f5c6c038a218be`. 브랜치 `work/windows-dev-dll`. PR26은 별도 검토 중이며 포함하지 않는다.

## 제공된 관찰과 원인 구분

- 사용자 Windows/Node26.13.1: production main/renderer 빌드 각각 종료0, 고지 수집 완료. 이후 npm start의 webpack 개발 설정에서 DLL 누락을 발견했다.
- 설정의 안내는 DLL 빌드였지만 실제 명령은 `npm run postinstall`이었다. postinstall은 Electron 의존성/네이티브 준비와 DLL을 모두 실행하므로 좁은 개발 DLL 복구가 아니다.
- execSync의 기본 파이프 출력이 오류 객체의 Buffer로만 보였다. 원래 postinstall의 어느 하위 단계가 실패했는지는 사용자 로그로 확정할 수 없다.
- 별도 연구 도구 설치 로그에는 Electron postinstall 승인 미적용이 명시돼 있다. 수동 ZIP 복구 대상은 연구 도구이고 루트 전체 앱 Electron과 별개다. 이번 단서를 과거 모든 설치 실패의 원인으로 일반화하지 않는다.

## 수정

변경 파일은 `.erb/configs/webpack.config.renderer.dev.ts`다. DLL 누락 시 `npm run build:dll`만 실행하고 cwd를 webpackPaths.rootPath로 고정, stdio를 inherit으로 둔다. 명령 안내도 실제 스크립트명으로 고친다. 실패는 포착/무시하지 않고 전파한다. 같은 파일의 기존 포맷 경고1건만 정리했다. 설치 의존성·postinstall 자체·제품 코드·프로필·온라인 정책은 바꾸지 않았다.

## 실행 검증

Linux x64, Node22.4.1, npm11.19.1, 기존 의존성 재사용. 이 npm은 해당 Node에서 미지원 경고가 있어 사용자 권장 조합으로 제시하지 않는다.

1. 실제 `.erb/dll`을 별도 임시 이름으로 이동해 누락 상태를 만들고, ts-node로 변경 개발 설정을 읽었다. 호출 디렉터리는 `/tmp`로 바꿨다. child_process 탐침으로 명령·cwd·stdio를 관찰하며 실제 빌드도 수행했다. **build:dll 1회만 실행**, 저장소 cwd, inherit 출력, renderer.json/renderer.dev.dll.js의 비어 있지 않은 결과, 설정 로드 완료를 확인했다.
2. 같은 설정 모듈을 캐시에서 제거하고 DLL이 존재하는 상태로 다시 읽었다. **추가 명령0회**. 검사 종료 finally에서 새 산출물을 제거하고 기존 DLL 폴더를 복원했다. 이 탐침은 앱 서버나 Electron을 띄우지 않았다.
3. 별도 프로세스에서 manifest 누락과 DLL 빌드 예외를 모의했다. 원래 예외 객체가 그대로 전파되고 build:dll 외 추가 명령/postinstall이 **0회**임을 확인했다. 모의는 실제 빌드 실패 환경을 재현한 것은 아니다.
4. `node node_modules/eslint/bin/eslint.js .erb/configs/webpack.config.renderer.dev.ts` 종료0, `git diff --check` 통과. 첫 lint에서 발견된 같은 파일의 기존 mock 가드 포맷 경고만 정리했다.

탐침 CJS는 임시 파일이며 제품/저장소에 추가하지 않았다. 좁은 빌드 설정 수정에 맞춰 실제 빌드와 분기 동작을 확인했고 전체 앱 단위 검증/메인·렌더러 production 빌드/패키징/UI/실계정 호출을 추가 실행하지 않았다.

## 사용자 PC 다음 확인

```powershell
npm run build:dll
if ($LASTEXITCODE -eq 0) {
    npm start
}
```

DLL 실패면 그 단계의 직접 출력으로 원인을 확인한다. 성공 뒤 앱 시작이 실패하면 DLL 오류와 구분한다. root/node_modules/electron과 tools/nai-validation/node_modules/electron 실행 파일은 각각 확인한다. 정상 연구 도구를 지우거나 재실험하지 않는다. [개발 안내](../DEVELOPMENT.md#windows-production-빌드는-성공했는데-npm-start가-dll에서-멈출-때).

Windows 전체 앱이 열렸다는 확인은 아직 없다. Node26/VS2026·실제 네이티브 ABI·정상 키링·정확한 MIME·실계정 생성도 미검증이다. 실제 API 호출0회, 토큰·계정값·이미지·개인 경로는 보관/커밋하지 않았다. 사용자 production 고지 수집의 미해결3건이라는 관찰은 Linux 기존8건을 해결했다는 뜻이나 재배포 허용 판정이 아니다.
