import { useCallback, useEffect, useRef, useState } from 'react';
import type { CutRequest, CutResult } from '../../recipeAssistant';

export default function useCutRequest() {
  const current = useRef<string>();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<CutResult>();
  const reset = useCallback(() => setResult(undefined), []);

  useEffect(
    () => () => {
      const id = current.current;
      current.current = undefined;
      if (id) window.electron.recipeAssistant.cancel(id).catch(() => {});
    },
    [],
  );

  const run = async (request: CutRequest) => {
    if (current.current) return;
    const id = crypto.randomUUID();
    current.current = id;
    reset();
    setPending(true);
    try {
      const reply = await window.electron.recipeAssistant.suggest(request, id);
      if (current.current === id) setResult(reply);
    } catch {
      if (current.current === id)
        setResult({ ok: false, message: '응답을 받지 못했습니다.' });
    } finally {
      if (current.current === id) {
        current.current = undefined;
        setPending(false);
      }
    }
  };

  const cancel = async () => {
    const id = current.current;
    if (!id) return;
    try {
      const stopped = await window.electron.recipeAssistant.cancel(id);
      if (!stopped || current.current !== id) return;
      current.current = undefined;
      setPending(false);
      setResult({ ok: false, message: '요청을 취소했습니다.' });
    } catch {
      if (current.current === id)
        setResult({
          ok: false,
          message: '취소를 확인하지 못했습니다. 다시 시도하세요.',
        });
    }
  };
  return { run, cancel, reset, pending, result };
}
