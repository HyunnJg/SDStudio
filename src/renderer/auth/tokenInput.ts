import type { NaiErrorCode, NaiTokenStatus } from '../../naiAuth';

export function prepareTokenInput(raw: string) {
  const token = raw.trim();
  return {
    token,
    trimmed: raw !== token,
    valid: /^[\x21-\x7e]{1,4096}$/.test(token),
  };
}

export function tokenStatusLabel(status?: NaiTokenStatus): string {
  if (!status?.configured) return '보관된 토큰 없음';
  return status.storage === 'session'
    ? '이번 실행에만 보관 중 · 서버 인증 미확인'
    : '저장된 토큰 있음 · 서버 인증 미확인';
}

export function authErrorMessage(code: NaiErrorCode): string {
  const messages: Partial<Record<NaiErrorCode, string>> = {
    INVALID_INPUT:
      '토큰을 확인해 주세요. 중간 공백·줄바꿈 없이 토큰 전체를 입력해야 합니다.',
    OFFLINE: '오프라인 모드에서는 토큰을 확인하거나 변경할 수 없습니다.',
    UNTRUSTED_SENDER:
      '이 창에서는 연결 설정을 사용할 수 없습니다. 앱을 다시 열어 주세요.',
    CANCELLED:
      '토큰 설정이 바뀌어 이전 작업을 중단했습니다. 현재 설정을 확인해 주세요.',
    TOKEN_MISSING: '보관된 토큰이 없습니다. 토큰을 입력해 주세요.',
    SECURE_STORAGE_UNAVAILABLE:
      '이 기기의 보안 저장을 사용할 수 없습니다. 이번 실행에만 보관을 선택해 주세요.',
    STORE_VERSION:
      '더 새로운 형식의 토큰 파일입니다. 원본은 그대로 두었습니다. 새로 입력하려면 저장된 토큰을 먼저 명시적으로 삭제해 주세요.',
    STORE_UNREADABLE:
      '보관된 토큰을 읽을 수 없습니다. 원본은 그대로 두었습니다. 삭제 후 다시 입력할 수 있습니다.',
    STORE_WRITE_FAILED:
      '토큰 보관을 변경하지 못했습니다. 저장 위치의 접근 권한을 확인해 주세요.',
  };
  return (
    messages[code] ?? '연결 설정을 처리하지 못했습니다. 다시 시도해 주세요.'
  );
}

// Remember once when secure storage exists; preserve an explicit session-only token.
export function defaultRememberToken(status: {
  secureStorageAvailable: boolean;
  storage: string;
}): boolean {
  return status.secureStorageAvailable && status.storage !== 'session';
}
