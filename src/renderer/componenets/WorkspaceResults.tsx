import { Dispatch, SetStateAction } from 'react';
import { WorkspaceState } from '../preview/workspaceDraft';
import previewArtwork from '../preview/previewArtwork';

export default function WorkspaceResults({
  state,
  setState,
}: {
  state: WorkspaceState;
  setState: Dispatch<SetStateAction<WorkspaceState>>;
}) {
  const result = state.results.find((item) => item.id === state.selectedResult);
  return (
    <section className="pw-canvas-column" aria-label="결과 미리보기">
      <div className="pw-canvas-toolbar">
        <h2>미리보기</h2>
        <span>
          {result
            ? `예제 ${String(result.id).padStart(2, '0')}`
            : '아직 실행하지 않은 초안'}
        </span>
      </div>
      <div className={`pw-canvas ${!result ? 'pw-canvas-empty' : ''}`}>
        <img
          src={result?.image ?? previewArtwork()}
          alt={
            result
              ? '직접 그린 정원 예제. AI 생성 결과가 아닙니다.'
              : '예제 배경으로 사용할 정원 일러스트'
          }
        />
        {!result && (
          <div className="pw-canvas-welcome">
            <span aria-hidden="true">✦</span>
            <h2>어떤 장면을 만들까요?</h2>
            <p>
              입력을 바꾼 뒤 예제 만들기를 눌러
              <br />새 작업 흐름을 확인해보세요.
            </p>
          </div>
        )}
      </div>
      <div className="pw-result-caption">
        <span>
          {result
            ? `${result.sceneName ? `${result.sceneName} · ` : ''}예제 일러스트 · 생성 모델 미연결`
            : '직접 그린 예제 일러스트'}
        </span>
        {result && <span>시드 {result.request.parameters.seed}</span>}
      </div>
      <div className="pw-history">
        <div className="pw-section-title">
          <h2>예제 기록</h2>
          <span>{state.results.length}개 · 메모리 보관</span>
        </div>
        <div className="pw-history-strip">
          {state.results.length ? (
            state.results.map((item) => (
              <button
                type="button"
                key={item.id}
                aria-label={`예제 ${item.id} 선택`}
                aria-pressed={item.id === state.selectedResult}
                onClick={() =>
                  setState((previous) => ({
                    ...previous,
                    selectedResult: item.id,
                  }))
                }
              >
                <img src={item.image} alt="" />
                <span>{String(item.id).padStart(2, '0')}</span>
              </button>
            ))
          ) : (
            <p>실행한 예제가 여기에 모입니다.</p>
          )}
        </div>
      </div>
    </section>
  );
}
