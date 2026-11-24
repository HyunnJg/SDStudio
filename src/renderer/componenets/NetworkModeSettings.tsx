import { useEffect, useRef, useState } from 'react';
import { restartFailureMessage } from '../network/restartPreparation';
import type { RestartFailure } from '../network/restartPreparation';
import type {
  NetworkMode,
  NetworkModeClient,
  NetworkModeResult,
  NetworkModeStatus,
} from '../../networkMode';

interface Props {
  client: NetworkModeClient | undefined;
  beforeRestart: () => Promise<RestartFailure | undefined>;
  onBusy: (busy: boolean) => void;
}
const errors: Record<string, string> = {
  INVALID_MODE: '온라인 또는 오프라인을 선택해 주세요.',
  MODE_LOCKED: '현재 실행에서는 모드가 고정되어 있습니다.',
  SETTINGS_UNREADABLE:
    '네트워크 설정을 읽을 수 없습니다. 초기화 후 다시 선택해 주세요.',
  SETTINGS_VERSION:
    '더 새로운 형식의 네트워크 설정입니다. 파일을 보존했습니다. 초기화 여부를 선택해 주세요.',
  SETTINGS_WRITE_FAILED:
    '네트워크 설정을 저장하지 못했습니다. 기존 설정은 유지됩니다.',
  UNTRUSTED_SENDER: '이 창에서는 연결 설정을 변경할 수 없습니다.',
  NO_RESTART_REQUIRED: '저장한 모드가 이미 적용되어 있습니다.',
  RESTART_FAILED:
    '자동 재시작을 시작하지 못했습니다. 저장된 설정은 앱을 다시 열 때 적용됩니다.',
  RESTARTING: '재시작을 준비 중입니다.',
};

export default function NetworkModeSettings({
  client,
  beforeRestart,
  onBusy,
}: Props) {
  const [status, setStatus] = useState<NetworkModeStatus>();
  const [selected, setSelected] = useState<NetworkMode>('offline');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<'reset' | 'restart'>();
  const alive = useRef(true);
  const pending = useRef(false);
  const run = async (action: () => Promise<NetworkModeResult>, notice = '') => {
    if (!client || pending.current) return;
    pending.current = true;
    setBusy(true);
    onBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await action();
      if (!alive.current) return;
      if (result.ok) {
        setStatus(result.status);
        setSelected(result.status.next);
        setMessage(notice);
      } else
        setError(errors[result.code] ?? '연결 설정을 처리하지 못했습니다.');
    } catch {
      if (alive.current)
        setError('연결 설정을 처리하지 못했습니다. 다시 열어 주세요.');
    } finally {
      pending.current = false;
      if (alive.current) {
        setBusy(false);
        onBusy(false);
      }
    }
  };
  useEffect(() => {
    alive.current = true;
    if (client) run(() => client.status());
    return () => {
      alive.current = false;
    };
    // The containing dialog mounts this section once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const locked = !!status?.lockedReason;
  const restart = async () => {
    if (pending.current || !client) return;
    pending.current = true;
    setBusy(true);
    onBusy(true);
    setConfirm(undefined);
    setError('');
    try {
      const failure = await beforeRestart();
      if (failure) {
        setError(restartFailureMessage(failure));
        return;
      }
      const result = await client.restart();
      if (!result.ok)
        setError(errors[result.code] ?? '재시작을 시작하지 못했습니다.');
      else setMessage('재시작 중… 세션 한정 토큰은 다시 입력해야 합니다.');
    } catch {
      if (alive.current) setError('재시작 준비를 완료하지 못했습니다.');
    } finally {
      pending.current = false;
      if (alive.current) {
        setBusy(false);
        onBusy(false);
      }
    }
  };
  return (
    <section className="nai-network" aria-labelledby="network-mode-title">
      <h3 id="network-mode-title">연결 모드</h3>
      <p data-testid="network-mode-status">
        현재: {status?.current === 'online' ? '온라인' : '오프라인'} · 다음
        시작: {status?.next === 'online' ? '온라인' : '오프라인'}
        {status?.pendingRestart ? ' · 재시작 필요' : ''}
      </p>
      <p>
        온라인에서는 계정/API 연결을 사용할 수 있습니다. 모드는 재시작 후
        적용됩니다. 새 작업실에서 저장된 씬을 생성할 수 있습니다.
      </p>
      {!client && <p>연결 모드 설정은 데스크톱 앱에서 사용할 수 있습니다.</p>}
      {locked && (
        <p data-testid="network-mode-locked">
          {status?.lockedReason === 'mock'
            ? '예제 모드에서는 온라인으로 전환하지 않습니다.'
            : '개발·검증 설정으로 현재 모드가 고정되어 있습니다.'}
        </p>
      )}
      {status?.issue && <p role="alert">{errors[status.issue]}</p>}
      <fieldset
        disabled={!client || busy || !status || locked || !!status.issue}
      >
        <legend>다음 시작에 적용할 모드</legend>
        <label className="nai-choice" htmlFor="network-mode-offline">
          <input
            id="network-mode-offline"
            name="network-mode"
            type="radio"
            checked={selected === 'offline'}
            onChange={() => setSelected('offline')}
          />
          오프라인
        </label>
        <label className="nai-choice" htmlFor="network-mode-online">
          <input
            id="network-mode-online"
            name="network-mode"
            type="radio"
            checked={selected === 'online'}
            onChange={() => setSelected('online')}
          />
          온라인
        </label>
        <button
          type="button"
          data-testid="network-mode-save"
          onClick={() => {
            run(
              () => client!.set(selected),
              '모드를 저장했습니다. 재시작 전까지 현재 모드는 유지됩니다.',
            );
          }}
        >
          다음 시작 모드 저장
        </button>
      </fieldset>
      <div className="nai-actions">
        <button
          type="button"
          data-testid="network-mode-restart"
          disabled={
            !client ||
            busy ||
            locked ||
            !status?.pendingRestart ||
            !!status.issue ||
            selected !== status.next
          }
          onClick={() => setConfirm('restart')}
        >
          재시작하고 적용
        </button>
        {status?.issue && !locked && (
          <button
            type="button"
            disabled={busy}
            data-testid="network-mode-reset"
            onClick={() => setConfirm('reset')}
          >
            네트워크 설정 초기화
          </button>
        )}
      </div>
      {confirm && (
        <div className="nai-confirm" role="group" aria-label="연결 모드 확인">
          <p>
            {confirm === 'restart'
              ? '앱을 재시작할까요? 기존 프로젝트는 먼저 저장합니다. 임시 초안·예제 기록과 세션 한정 토큰은 사라집니다.'
              : '네트워크 설정만 초기화할까요? 토큰과 프로젝트 파일은 지우지 않습니다. 다음 시작은 오프라인입니다.'}
          </p>
          <button
            type="button"
            disabled={busy}
            data-testid="network-mode-cancel"
            onClick={() => setConfirm(undefined)}
          >
            취소
          </button>
          <button
            type="button"
            disabled={busy}
            data-testid="network-mode-confirm"
            onClick={() => {
              if (confirm === 'restart') restart();
              else {
                setConfirm(undefined);
                run(
                  () => client!.reset(),
                  '네트워크 설정을 초기화했습니다. 토큰·프로젝트는 유지됩니다.',
                );
              }
            }}
          >
            확인
          </button>
        </div>
      )}
      {message && (
        <p role="status" data-testid="network-mode-message">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" data-testid="network-mode-error">
          {error}
        </p>
      )}
    </section>
  );
}
