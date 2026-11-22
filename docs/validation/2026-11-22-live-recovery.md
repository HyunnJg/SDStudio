# 첫 응답의 MIME 처리·중단 기록 보완 검증

2026-11-22 (Asia/Seoul). 기준 PR15 병합 b79fa4e643de805589c4149c2b76330b63cf019d. 구현 fdc8c65b9114dc818c538458b7c245c4e6845d52 / 트리73a79bcc3e66d3fee0c4d12f637bac1f30a4f454. [요약](2026-11-22-live-recovery-summary.json), [합성 Electron 결과](2026-11-22-live-recovery-runtime.json), [사용자 첫 실측의 정제 관찰](2026-11-22-first-live-observation.json).

사용자가 Windows에서 실제1회 전송해 HTTP200/ZIP시작부를 보고했으나 MIME분류other로64KiB에서잘렸다. 정확한 MIME/전체PNG는 없으며 잘린 원문을 복구했다고 표시하지 않는다. 계정 잔액·토큰·이미지·원시 본문은 기록하지 않았다. 잔액 관찰차이0은 개별 청구의 증명이 아니다. 다음 표의 검증은 모두 개발 환경의 가짜 토큰/루프백이며 추가 계정 호출이 아니다.

| 검사 | 결과 |
| --- | --- |
| test:nai-live | 10/10. 기존8건 + 결과 없는 재개/불완전 후잔액·덮어쓰기/재전송 금지, 다른 해시/버전 보존. 현재 실행 중 후잔액 거부와 elapsedMs 검사도 포함 |
| test:nai-main | 27/27. 기존23건 + 분할된4바이트ZIP시작부/미분류MIME/64KiB초과, HTML·비2xx·기본 정책 유지, 시작부만인 잘못된ZIP의 엄격 해석 거부,64MiB상한 |
| 기존 응답/오프라인 | test:nai-response19/19, test:offline11/11 |
| 실제 연구 Electron | 7테스트/42체크. 기존5경로 + 미분류MIME의 streaming DEFLATE/data descriptor ZIP + 결과 없는 프로필 재개 |
| 독립 설치 기동 회귀 | tools/nai-validation 테스트3/3. 루트 node_modules 없는 임시 체크아웃의 실제 강제오프라인 창 포함 |
| 새 메인 타입/린트 | 엄격 범위 타입·린트 통과. 전체 저장소 TS2688 해결 주장은 하지 않음 |
| production 빌드 | main/preload/renderer와 고지 생성 통과. 고지244레코드·미확인 원문8건 유지 |

Linux x64/호스트Node22.4.1/실제Electron26.6.10·내장Node18.16.1, 기존 설치 재사용. 빌드 하위 npm명령은 현재 호스트의 npm11.19.1이 Node22.4.1을 지원하지 않는다는 경고를 남긴다. 이를 새 지원 조합 또는 새 npm ci 검증으로 삼지 않는다. 새로운 의존성·패키징·Windows자동화·실제계정 재호출은 없다. 연구 entry에서만 MIME보완 옵션을 켜며 일반 앱의 기본 정책은 그대로다.

## 실제 Electron의 문제 재현

합성 PNG에80,000바이트 불투명 metadata를 넣고 ZIP compression=DEFLATE/streamFiles=true로 응답했다. MIME는 공식 서버의 값을 추정하지 않은 application/x-sdstudio-test다. HTTP200·분류other·ZIP flags8/method8/extra0으로 사용자 관찰과 같은 분기를 재현했다.

전체 ZIP80,288바이트가64KiB에서잘리지 않고 보관되고, PNG80,131바이트가 원본과 동일하다. acceptedByZipSignature=true, captureTruncated=false, 로컬 재검사 성공과 두 번째 요청 거부를 확인했다. 다른 기존 경로도 루프백1회씩이고 offline/기록복구 경로는0회다. PNG검증 성공은 이 합성 fixture에 대한 결과다.

중단 재개는 attempt.json만 사전에 만들고 창을 열었다. 결과 부재 안내·후잔액 버튼 활성·incomplete=true/resultRecord=missing 기록·result.json을 새로 만들지 않음·재전송/덮어쓰기 거부를 확인했다. 이 상태는 파일의 부재이지 다른 프로세스의 종료/서버 처리/청구 여부 판정이 아니다.

## 유지한 경계

- acceptZipSignature와capture가 둘 다 켜진2xx에만 수신 대체 경로를 적용한다. 시작부4바이트는 분할 청크에서도 검사한다. HTTP오류/HTML/JSON/옵션미지정은 기존 오류 경로다.
- 수신64MiB·PNG32MiB·기존 픽셀/CRC/구조/기한/취소 검사를 완화하지 않았다. ZIP시작부만인 데이터는 INVALID_IMAGE_RESPONSE/zip-eocd로 거부한다. 보관 오류/해석 실패에도 mayHaveReachedServer를 유지한다.
- 후보JSON/seed0/해시f9ab…는 그대로다. 기존사용자프로필/잔액/PNG를 이 환경으로 가져오지 않고 새 프로필이나 실제 요청을 자동으로 생성하지 않는다.
- elapsedMs는 현재 코드의 전송·보관·해석 구간 시간이며 과거시도의 시간을 복원하지 않는다. 결과기록후잔액파일은 계속wx/0600이며 손상/미지원attempt를 덮어쓰지 않는다.

실행: npm run test:nai-live, test:nai-main, test:nai-response, test:offline; X11에서 test:nai-live:electron 및 독립도구test. 범위 tsc/eslint와 main/renderer 빌드도 수행했다. 추가 실험은 [D-034 수동 비용/횟수 조건](../NAI_LIVE_VALIDATION.md#첫-관찰과-수정-후-추가1회-규칙-d-034)을 따른다.
