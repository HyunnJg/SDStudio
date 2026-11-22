export type RestartBlocker =
  'LEGACY_RUNNING' | 'LEGACY_PENDING' | 'WORKSPACE_PENDING';
export type RestartFailure = RestartBlocker | 'SAVE_FAILED' | 'PROJECT_NOT_READY';

export async function prepareRestart(
  busy: () => RestartBlocker | undefined,
  save: () => Promise<void>,
): Promise<RestartFailure | undefined> {
  const before = busy();
  if (before) return before;
  try {
    await save();
  } catch {
    return 'SAVE_FAILED';
  }
  return busy();
}

export function restartFailureMessage(failure: RestartFailure): string {
  const messages = {
    LEGACY_RUNNING:
      '기존 V3 화면 작업이 아직 실행·종료 중입니다. 남은 개수가 0이어도 종료 완료를 기다려 주세요.',
    LEGACY_PENDING: '기존 V3 화면의 예약 작업을 마치거나 비워 주세요.',
    WORKSPACE_PENDING: '새 작업실의 대기열을 마치거나 비워 주세요.',
    PROJECT_NOT_READY: '새 작업실의 저장·복사 또는 취소 선택을 확인해 주세요. 입력은 유지됩니다.',
    SAVE_FAILED: '기존 프로젝트를 저장하지 못해 재시작을 중단했습니다.',
  };
  return messages[failure];
}
