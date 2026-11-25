import type {
  GenerationFailure,
  GenerationQueueState,
  GenerationSettings,
} from '../../workspaceGeneration';

export const ANLAS_STEP_WARNING =
  '28스텝 초과는 Opus도 Anlas를 사용할 수 있습니다.';

export function requiresAnlasWarning(
  settings: Pick<GenerationSettings, 'steps'>,
) {
  return settings.steps > 28;
}

export function generationMessage(
  error: unknown,
  scenes: readonly { id: string; name: string }[] = [],
): string {
  const e = error as Partial<GenerationFailure>;
  const detail: Record<string, string> = {
    OFFLINE:
      '오프라인입니다. API 토큰 설정에서 연결 모드를 변경하고 재시작하세요.',
    UNSUPPORTED_DRAFT:
      'V5 Full 또는 기존 V4.5 기본 설정을 확인하세요. 생성에 사용할 V5 캐릭터는 최대22명·자동 배치를 확인하세요. 수동 위치·| 문법·프롬프트 조각 전개는 아직 지원하지 않습니다.',
    INVALID_INPUT:
      '기본 프롬프트 또는 생성에 사용할 V5 캐릭터 프롬프트를 입력하고 고정 시드(0~4294967295)를 확인하세요.',
    TOKEN_MISSING: 'API 토큰 설정에서 Persistent API Token을 입력하세요.',
    STORE_UNREADABLE:
      '저장된 토큰을 읽지 못했습니다. API 토큰 설정에서 로컬 읽기 확인을 해주세요.',
    STORE_VERSION:
      '저장된 토큰 형식을 읽지 못했습니다. API 토큰 설정에서 복구 안내를 확인하세요.',
    CONFIRMATION_EXPIRED:
      '확인이 만료됐거나 이미 사용됐습니다. 입력 저장 후 새 설정을 확인하세요.',
    QUEUE_LIMIT:
      '예약은 최대 60건입니다. 참조 이미지·프롬프트 크기가 큰 경우 예약 횟수를 줄여 주세요.',
    GENERATION_BUSY: '진행 중 요청이나 저장하지 못한 결과를 먼저 처리하세요.',
    CANCELLED: '취소했습니다.',
    TIMEOUT: '응답 기한을 넘었습니다.',
    RESULT_SAVE_FAILED:
      'PNG는 받았지만 저장 결과를 확정하지 못했습니다. 결과만 다시 저장하면 API를 재호출하지 않습니다.',
    PROJECT_BUSY:
      '남은 저장 잠금이 있습니다. 프로젝트를 새 복사본으로 계속한 뒤 새로 확인하세요.',
    PROJECT_LIMIT:
      '프로젝트 보관 한도에 가깝습니다. 새 프로젝트에서 계속하세요.',
    PROJECT_CONFLICT:
      '프로젝트가 변경됐습니다. 다시 열어 저장 상태를 확인하세요.',
  };
  let text =
    detail[e.code ?? ''] ??
    '요청 또는 결과를 처리하지 못했습니다. 입력은 유지되며 자동 재시도하지 않습니다.';
  if (e.code === 'QUEUE_INPUT_CHANGED') {
    const name = scenes.find((scene) => scene.id === e.conflictSceneId)?.name;
    text = name
      ? `예약한 씬 “${name}”의 입력이 바뀌었거나 씬이 삭제됐습니다. 예약 당시 입력을 복원한 뒤 미전송 작업을 다시 확인하세요. 복원이 어렵다면 그 씬의 미전송 작업만 제외할 수 있습니다.`
      : '예약한 씬의 입력이 바뀌었거나 씬이 삭제됐습니다. 예약 당시 입력을 복원한 뒤 미전송 작업을 다시 확인하세요. 복원이 어렵다면 그 씬의 미전송 작업만 제외할 수 있습니다.';
    text += ' 보관 중인 빈 카드 편집도 입력 변경으로 셉니다.';
  }
  if (e.httpStatus === 401)
    text = '토큰 인증이 거부됐습니다. API 토큰 설정을 확인하세요.';
  if (e.httpStatus === 402)
    text = '계정의 잔액·사용 조건을 NovelAI 웹에서 확인하세요.';
  if (e.httpStatus === 429)
    text = '요청 한도에 도달했습니다. 자동 재시도하지 않습니다.';
  if (e.mayHaveReachedServer)
    text += ' 서버가 이미 처리했거나 사용량이 소모됐을 수 있습니다.';
  return text;
}
export function availableQueueSceneIds(
  ids: string[],
  scenes: readonly { id: string }[],
): string[] {
  const valid = new Set(scenes.map((scene) => scene.id));
  return ids.every((id) => valid.has(id))
    ? ids
    : ids.filter((id) => valid.has(id));
}

export function queueOutcome(queue: GenerationQueueState | undefined) {
  const item = queue?.items.find((value) => value.id === queue.stoppedItemId);
  const error =
    item &&
    (item.status === 'pending' ||
      item.status === 'failed' ||
      item.status === 'result-pending')
      ? item.error
      : undefined;
  return {
    error,
    pending: !!queue?.items.some((value) => value.status === 'result-pending'),
    storageStopped:
      error?.projectCode === 'PROJECT_SERVICE_STOPPED' ||
      error?.code === 'PROJECT_SERVICE_STOPPED',
  };
}
