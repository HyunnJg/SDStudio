# 충돌 오류 정리와 새 작업실 실계정 확인 준비

작성일: 2026-11-23 (Asia/Seoul). 기준 `e36b94f0d92f983e515a218076f5c6c038a218be`. 런타임 `4534cbd9377baa5122eaca17e839864e6ebdbdc7`, tree `9f4c4aea50d338271e8df169773922240e7a336e`. [D-046](../DECISIONS.md), [처리](../reviews/2026-11-23-pr25-followup.md), [사용자 실행 순서](../WORKSPACE_LIVE_CHECK.md).

## 변경과 재현

제외한 충돌 씬과 현재 중단 항목의 씬이 다를 수 있다. 기존 `excludePendingScene`은 제외 씬의 pending 오류만 지워 현재 준비 항목에 `QUEUE_INPUT_CHANGED`가 남았다. 현재 중단 오류·충돌 씬 ID·확인·idle 검사를 통과한 뒤 해당 중단 오류도 지운다. 새 네트워크/파일 작업이나 IPC는 없다.

신규 서비스 테스트는 3씬×2회에서 첫 요청 중 세 번째 씬을 변경한다. 첫 PNG만 저장 → 두 번째 씬 준비에서 중지 → 세 번째 씬2건만 제외 → 현재 준비 항목 오류 없음·상태pending → 기존 확인 재사용 거부 → 나머지3건 새 확인/실행 → 총4PNG 저장을 확인한다. 제외 전후 manifest 동일·전송 횟수1 유지, 남은 순서와 승인 시드/본문 보존은 기존 테스트와 함께 확인한다.

## 실행 결과

Linux x64, Node22.4.1, 기존 의존성 재사용. npm11.19.1은 이 Node 버전과의 지원 경고가 있어 권장 조합으로 제시하지 않는다. 루트 설치·네이티브 재빌드·의존성 갱신은 하지 않았다.

```sh
node --test -r ts-node/register/transpile-only \
  src/__tests__/generationQueue.test.cjs \
  src/__tests__/generationPresentation.test.cjs \
  src/__tests__/workspaceGeneration.test.cjs \
  src/__tests__/projectReads.test.cjs
```

최종 **63/63**, 실패0·건너뜀0: 대기열34 + 표시5 + 기본생성16 + PNG읽기8. 새 테스트를 추가한 첫 `test:generation-queue` 실행도39/39였다.

통합 첫 실행은62/63이었다. 변경하지 않은 MIME 관찰 테스트가 `existsSync(file)` 직후, 비동기 writeFile이 JSON을 쓰기 전에 빈 파일을 읽어 `Unexpected end of JSON input`으로 실패했다. 파일이 없거나 크기0이면 기존 상한 안에서 기다리게 고쳤다. JSON 파싱·기대 필드·0600·관찰 후 미덮어쓰기 조건을 완화하지 않았다. 그 뒤 위63건을 전부 다시 실행해 통과했다.

```sh
node node_modules/eslint/bin/eslint.js src/main/nai/workspaceGeneration.ts
node node_modules/typescript/bin/tsc --noEmit --strict --esModuleInterop \
  --target ES2022 --module commonjs --moduleResolution node --types node \
  --skipLibCheck src/main/nai/workspaceGeneration.ts
npm run build:main
```

모두 종료0. production main/preload/projectWorker 빌드 통과. 변경 TS와 테스트 CJS3개 Prettier, CJS2개 문법, `git diff --check` 통과. 전체 저장소 tsc의 기존 TS2688 해결을 의미하지 않는다.

## 실행하지 않은 것

렌더러 변경은 없으며 렌더러 빌드·Electron UI·ASAR 패키지·고지 재생성/검사·Windows/macOS는 재실행하지 않았다. 이 작은 메모리 오류 정리에 맞춰 서비스/상태·타입·메인 빌드를 확인했다. PR25의 이전 UI/패키지 검증과 이번 결과는 별개다.

실제 계정 호출 **0회**. 새 작업실 실계정1장·반복2회·정확한 MIME·429 빈도·사용량/Anlas·정상 OS 키링·Windows 설치 성공은 미확인이다. [사용자 확인 절차](../WORKSPACE_LIVE_CHECK.md)의 성공 칸을 미리 채우지 않았다. 현재 구현은 자동 과금 실험이나 추가 모델 실험을 수행하지 않는다.
