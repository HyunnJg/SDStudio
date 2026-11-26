import { useContext, useEffect, useState } from 'react';
import { runtimeOptions } from '../runtime';
import { FloatView } from './FloatView';
import ConfigScreen from './ConfigScreen';
import SessionSelect from './SessionSelect';
import { Session } from '../models/types';
import { loginService, backend, taskQueueService } from '../models';

const TobBar = ({ onOpenPreview, onOpenAuth }: { onOpenPreview?: () => void; onOpenAuth?: () => void }) => {
  const [loggedIn, setLoggedIn] = useState(false);
  const [credits, setCredits] = useState(0);

  useEffect(() => {
    const onChange = () => {
      setLoggedIn(loginService.loggedIn);
      (async () => {
        try {
          const credits = await backend.getRemainCredits();
          setCredits(credits);
        } catch (e) {}
      })();
    };
    onChange();
    loginService.addEventListener('change', onChange);
    taskQueueService.addEventListener('complete', onChange);
    return () => {
      loginService.removeEventListener('change', onChange);
      taskQueueService.removeEventListener('complete', onChange);
    };
  }, []);

  const [settings, setSettings] = useState(false);

  return (
    <div className={'flex border-b line-color px-2 py-2 items-center'}>
      <div className="gap-3 hidden md:flex text-sky-500 font-bold dark:text-white">
        SDStudio · V3 도구
      </div>
      {onOpenPreview && <button type="button" className="round-button back-sky ml-3" data-testid="open-preview" onClick={onOpenPreview}>{runtimeOptions.mockBackend ? '새 화면 미리보기' : '작업실로 돌아가기'}</button>}
      {onOpenAuth && <button type="button" className="round-button back-sky ml-2" data-testid="open-nai-auth" onClick={onOpenAuth}>API 토큰</button>}
      <p className="ml-auto mr-2 hidden md:block">
        {runtimeOptions.offline ? <span className="round-tag back-yellow">{runtimeOptions.mockBackend ? '오프라인 예제 · 실제 생성 없음' : '오프라인 · 계정/API 연결 없음'}</span> : !loggedIn ? (
          <span className={`round-tag back-red`}>
            V3 로그인 안 됨 · 새 API 토큰은 별도
          </span>
        ) : (
          <>
            <span className="text-sub">Anlas: </span>{' '}
            <span className={`round-tag back-yellow`}>{credits}</span>
          </>
        )}
      </p>
      <button
        className={`round-button back-sky`}
        data-testid="open-config"
        onClick={() => {
          setSettings(true);
        }}
      >
        환경설정
      </button>
      <p className="md:hidden ml-2">
        {!loggedIn ? (
          <span className={`round-tag back-red`}>V3 로그인 안 됨</span>
        ) : (
          <>
            <span className={`round-tag back-yellow mr-2`}>{credits}</span>
          </>
        )}
      </p>
      <div className="ml-auto block md:hidden">
        <SessionSelect />
      </div>
      {settings && (
        <FloatView
          priority={1}
          onEscape={() => {
            setSettings(false);
          }}
        >
          <ConfigScreen
            onSave={() => {
              setSettings(false);
            }}
          />
        </FloatView>
      )}
    </div>
  );
};

export default TobBar;
