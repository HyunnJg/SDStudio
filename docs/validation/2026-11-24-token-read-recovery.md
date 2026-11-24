# 실패한 토큰 교체와 동시 읽기 — 2026-11-24

기준 main `dcdae0b`(PR31/32 병합). D-053. 변경 운영 코드는 tokenStore.read의 대기한 저장 실패 처리뿐이다. 보존 상태를 새로 검증하고 세대 guard는 그대로 둔다.

수정 전 테스트를 기존 소스에서 실행해 세션/암호문 두 경우의 동시 read가 STORE_WRITE_FAILED로 실패함을 재현했다(Node24.22.3 호스트, 2/2 예상 실패). 수정본 검증은 아래처럼 저장소 기준 Node26.13.1/npm11.21.3을 사용했다. Node26 공식 archive의 SHASUMS256 확인 후 도구를 선택했다.

- 전체 단위263/263 통과(기존255 + 신규8). 신규: 세션/암호문 기존 A 읽기2, 초기 저장 실패 후 TOKEN_MISSING1, 대기 중 clear/lock/replace CANCELLED3, 외부 손상/상위 버전 보존2.
- 변경 TS eslint·store/IPC strict tsc·production build 통과. Electron45.4.1의 OS probe/인증·전송 2/2 통과(basic provider 거부만 검증, 인증 하네스13체크·루프백7회).
- 통합된 새 작업실의 실제 Electron3PID/13체크 통과: 밝은/어두운 테마·생성/취소·저장-only 복구·오프라인 재열기, 루프백3회·외부 요청/renderer 오류0·실제 계정0.
- CI의 Windows/Linux clean 설치·암호문 교차검사·263단위·빌드·패키지·고지는 새 PR 체크에서 확인하고 PR 본문에 최종 결과를 연결한다.

신규 단위 테스트의 토큰과 암호기는 모두 합성이다. API 호출/사용자 파일/실계정 키를 쓰지 않는다. Linux 실제 GNOME/KDE keyring·macOS·사용자 Windows 화면은 이번 환경에서 미검증이다. Linux 가용성 조건이나 Electron 버전을 변경하지 않았다.

GUI는 임시 Xorg에서 실행했다. root 컨테이너의 sandbox/singleton 우회는 하네스에만 적용했고 제품 설정은 완화하지 않았다. Electron 바이너리/도구를 새로 올리거나 사용자 프로필을 열지 않았다.
