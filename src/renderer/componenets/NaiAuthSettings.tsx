import { useEffect, useRef, useState } from 'react';
import type { RestartFailure } from '../network/restartPreparation';
import type {
  NaiAuthClient,
  NaiAuthResult,
  NaiTokenStatus,
} from '../../naiAuth';
import {
  authErrorMessage,
  prepareTokenInput,
  tokenStatusLabel,
  defaultRememberToken,
} from '../auth/tokenInput';
import './NaiAuthSettings.css';
import VibeProviderSettings from './VibeProviderSettings';
import NetworkModeSettings from './NetworkModeSettings';
import type { NetworkModeClient } from '../../networkMode';

interface Props {
  onClose: () => void;
  offline: boolean;
  client: NaiAuthClient | undefined;
  networkClient: NetworkModeClient | undefined;
  beforeRestart: () => Promise<RestartFailure | undefined>;
}

export default function NaiAuthSettings({
  onClose,
  offline,
  client,
  networkClient,
  beforeRestart,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  const pending = useRef(false);
  const storageChoiceSet = useRef(false);
  const [status, setStatus] = useState<NaiTokenStatus>();
  const [busy, setBusy] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [networkBusy, setNetworkBusy] = useState(false);
  const enabled = !!client && !offline;

  const run = async (action: () => Promise<NaiAuthResult>, message = '') => {
    if (!enabled || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await action();
      if (!alive.current) return;
      if (result.ok) {
        setStatus(result.status);
        if (!storageChoiceSet.current) {
          setRemember(defaultRememberToken(result.status));
          storageChoiceSet.current = true;
        }
        setNotice(message);
      } else setError(authErrorMessage(result.code));
    } catch {
      if (alive.current)
        setError('연결 설정을 처리하지 못했습니다. 다시 열어 주세요.');
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };

  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement as HTMLElement | null;
    const control = input.current;
    const modal = dialog.current;
    modal?.showModal();
    modal?.focus();
    if (enabled) run(() => client!.status());
    return () => {
      alive.current = false;
      if (control) control.value = '';
      if (modal?.open) modal.close();
      previous?.focus();
    };
    // The dialog is remounted for every opening; no secret is retained by App.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = () => {
    const prepared = prepareTokenInput(input.current?.value ?? '');
    if (prepared.trimmed && input.current) input.current.value = prepared.token;
    if (!prepared.valid) {
      setError(authErrorMessage('INVALID_INPUT'));
      setNotice(prepared.trimmed ? '앞뒤 공백·줄바꿈을 제거했습니다.' : '');
      return;
    }
    run(
      async () => {
        const result = await client!.setToken(prepared.token, remember);
        if (result.ok && input.current) input.current.value = '';
        return result;
      },
      prepared.trimmed
        ? '앞뒤 공백·줄바꿈을 제거하고 보관했습니다. 서버 인증은 확인하지 않았습니다.'
        : '토큰을 보관했습니다. 서버 인증은 확인하지 않았습니다.',
    );
  };

  return (
    <dialog
      ref={dialog}
      className="nai-auth"
      tabIndex={-1}
      aria-labelledby="nai-auth-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!networkBusy) onClose();
      }}
      data-testid="nai-auth-dialog"
    >
      <header>
        <h2 id="nai-auth-title">API 토큰·연결 모드</h2>
        <button
          type="button"
          onClick={onClose}
          disabled={networkBusy}
          aria-label="토큰 설정 닫기"
        >
          닫기
        </button>
      </header>
      <NetworkModeSettings
        client={networkClient}
        beforeRestart={beforeRestart}
        onBusy={setNetworkBusy}
      />
      {window.electron?.providerKeys && (
        <VibeProviderSettings disabled={offline || networkBusy} />
      )}
      <h3>NovelAI 이미지 생성</h3>
      <p role="status" data-testid="nai-auth-status">
        {tokenStatusLabel(status)}
      </p>
      {offline && (
        <p>오프라인 모드에서는 토큰을 확인하거나 변경할 수 없습니다.</p>
      )}
      {!client && <p>토큰 보관은 데스크톱 앱에서 사용할 수 있습니다.</p>}
      <fieldset disabled={!enabled || busy || networkBusy}>
        <legend>새 토큰 보관</legend>
        <p>
          계정 비밀번호가 아닙니다. NovelAI 사용자 설정의 Account에서 Get
          Persistent API Token으로 발급한 값을 입력해 주세요.
        </p>
        <label htmlFor="nai-token-input">
          Persistent API token
          <input
            ref={input}
            id="nai-token-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-describedby="nai-token-help"
          />
        </label>
        <p id="nai-token-help">
          붙여넣은 값의 앞뒤 공백·줄바꿈은 제거하고 안내합니다. 보관한 토큰은
          다시 표시하지 않습니다.
        </p>
        <label className="nai-choice" htmlFor="nai-session">
          <input
            type="radio"
            id="nai-session"
            name="nai-storage"
            checked={!remember}
            onChange={() => setRemember(false)}
          />
          이번 실행에만 보관
        </label>
        <label className="nai-choice" htmlFor="nai-persistent">
          <input
            type="radio"
            id="nai-persistent"
            name="nai-storage"
            checked={remember}
            disabled={!status?.secureStorageAvailable}
            onChange={() => setRemember(true)}
          />
          이 기기의 보안 저장에 보관
        </label>
        {enabled && status && !status.secureStorageAvailable && (
          <p>
            이 기기의 보안 저장을 사용할 수 없어 이번 실행에만 보관할 수
            있습니다.
          </p>
        )}
        <button type="button" data-testid="nai-auth-save" onClick={save}>
          토큰 보관
        </button>
      </fieldset>
      <div className="nai-actions">
        <button
          type="button"
          disabled={!enabled || busy || networkBusy}
          onClick={() => {
            run(() => client!.status());
          }}
          data-testid="nai-auth-refresh"
        >
          보관 상태 새로 확인
        </button>
        <button
          type="button"
          disabled={!enabled || busy || networkBusy || !status?.configured}
          onClick={() => {
            run(
              () => client!.check(),
              '이 기기에서 토큰을 읽을 수 있습니다. 서버 인증은 확인하지 않았습니다.',
            );
          }}
          data-testid="nai-auth-check"
        >
          기기에서 읽기 확인
        </button>
        <button
          type="button"
          disabled={!enabled || busy || networkBusy || !status?.configured}
          onClick={() => setConfirmDelete(true)}
          data-testid="nai-auth-delete"
        >
          보관된 토큰 삭제
        </button>
      </div>
      {confirmDelete && (
        <div className="nai-confirm" role="group" aria-label="토큰 삭제 확인">
          <p>
            이 앱에 보관된 토큰을 삭제할까요? NovelAI에서 토큰을 폐기하는 동작은
            아닙니다.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmDelete(false)}
          >
            취소
          </button>
          <button
            type="button"
            disabled={!enabled || busy || networkBusy}
            data-testid="nai-auth-confirm-delete"
            onClick={() => {
              setConfirmDelete(false);
              run(async () => {
                const result = await client!.clear();
                if (result.ok && input.current) input.current.value = '';
                return result;
              }, '이 앱에 보관된 토큰을 삭제했습니다.');
            }}
          >
            삭제 확인
          </button>
        </div>
      )}
      {busy && <p aria-live="polite">처리 중…</p>}
      {notice && (
        <p aria-live="polite" data-testid="nai-auth-notice">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" data-testid="nai-auth-error">
          {error}
        </p>
      )}
    </dialog>
  );
}
