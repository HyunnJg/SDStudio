# 밝은 테마 생성 버튼 색 복구 — 2026-11-24

기준 main `c6ceb01`(PR30 병합). 사용자 Windows/V5 정상 실행 보고와 함께 받은 "밝은 테마에서 생성 버튼을 누른 뒤 백색화" 결함을 독립 UI 변경으로 다룬다. API/토큰/모델/프로젝트 형식 변경을 포함하지 않는다.

## 재현과 원인

Linux Electron45.4.1 실제 작업실에서 포인터를 버튼 밖으로 옮기고 계산된 스타일을 검사했다. 기존 `.pw-light .pw-generate`는 글자만 흰색으로 정하고, 더 우선하는 `.connected-workspace button`이 배경을 흰색 panel로 만든다. 따라서 결과는 배경/글자 모두 `rgb(255, 255, 255)`다. hover 규칙에서는 강조 배경이 보이지만 포인터가 벗어나거나 disabled가 되면 흰 배경이 드러난다. 생성 상태가 색 값을 저장하는 버그는 아니다.

밝은 테마 규칙을 `.preview-workspace.pw-light .pw-generate`로 한정하고 배경을 기존 accent(`#087b6c`)로 지정했다. 기존 hover는 `#09695d`를 유지하고 disabled opacity도 그대로다. 어두운 테마 배경/글자·배치·동작은 바꾸지 않는다.

## 검증

- 수정 전 실제 렌더러의 light=true/disabled=false 검사가 흰 배경/흰 글자로 실패함을 재현했다. 전송0회다. 검사기 최초 편집 중 문법 오류가 한 번 있었고 바로 수정했다. 그 오류를 제품 재현으로 세지 않는다. 첫 수정 후 검사에서 fieldset의 disabled를 button.disabled로 잘못 읽은 문제도 발견해 :disabled로 고쳤다. 제품의 비활성 조건을 완화하지 않았다.
- production build 후 `smoke:generation`의 합성3PID 경로를 실행한다. 기존11체크에 두 테마의 생성 완료/disabled/취소 후 계산 색 검사2개를 추가했다. dark는 기존 panel/text, light는 accent/white를 요구한다. 테마 변경 때문에 새 API 요청을 추가하지 않는다.
- 실제 계정/키/사용자 파일은 사용하지 않는다. 원격 목적지는 하네스에서만 루프백으로 바꾼다. 임시 Xorg·검사용 sandbox/singleton 우회는 제품 설정에 적용하지 않는다.

최종 결과: Node26.13.1/npm11.21.3 production build·실제 Electron45.4.1 새3PID/13체크 통과. 루프백3회, 외부 요청/renderer 오류0, 실제 계정0. 생성 완료·효과상 disabled(fieldset 포함)·취소 뒤에 두 테마의 색이 유지됐다. Windows 사용자의 화면에서 이 수정본을 재확인한 결과는 아직 없다.
