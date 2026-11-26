/* eslint jsx-a11y/label-has-associated-control: ["error", { "assert": "either" }] */
import { useState } from 'react';
import type { WorkspaceDraft } from '../preview/workspaceDraft';
import {
  MODELS,
  ModelId,
  modelId,
  allowedSize,
  draftSize,
} from '../../workspaceCatalog';
import { resolutionMap } from '../backends/imageGen';

export default function ModelSizeControls({
  draft,
  patch,
}: {
  draft: WorkspaceDraft;
  patch: (v: Partial<WorkspaceDraft>) => void;
}) {
  const [custom, setCustom] = useState(false);
  const [w, setW] = useState('832');
  const [h, setH] = useState('1216');
  const size = draftSize(draft);
  const legacy = !draft.model && draft.family === 'v4.5';
  const sizeKey =
    legacy || draft.resolution.includes('x') ? 'actual' : draft.resolution;
  const current = modelId(draft);
  const setResolution = (resolution: WorkspaceDraft['resolution']) => {
    patch({ resolution, ...(legacy ? { model: current } : {}) });
    setCustom(false);
  };
  return (
    <>
      <label htmlFor="live-model">모델</label>
      <select
        id="live-model"
        value={current}
        onChange={(e) => {
          const id = e.target.value as ModelId;
          const v5 = id.startsWith('nai-diffusion-5-');
          patch({
            model: id === 'nai-diffusion-5-full' ? undefined : id,
            family: v5 ? 'v5' : 'v4.5',
            resolution: legacy ? '512x512' : draft.resolution,
            qualityTags:
              v5 && id === 'nai-diffusion-5-full'
                ? (draft.qualityTags ?? 'standard')
                : 'none',
            ucPreset:
              v5 && id === 'nai-diffusion-5-full'
                ? (draft.ucPreset ?? 'heavy')
                : 'none',
          });
          setCustom(false);
        }}
      >
        {Object.entries(MODELS).map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
      <label htmlFor="live-size">크기</label>
      <select
        id="live-size"
        value={custom ? 'custom' : sizeKey}
        onChange={(e) => {
          if (e.target.value === 'custom') {
            setW(String(size.width));
            setH(String(size.height));
            setCustom(true);
          } else if (e.target.value !== 'actual')
            setResolution(e.target.value as WorkspaceDraft['resolution']);
        }}
      >
        {(legacy || draft.resolution.includes('x')) && (
          <option value="actual">
            {size.width} × {size.height}
          </option>
        )}
        {Object.entries(resolutionMap)
          .filter(([k]) => k !== 'custom')
          .map(([k, s]) => (
            <option key={k} value={k}>
              {s.width} × {s.height}
            </option>
          ))}
        <option value="custom">직접 입력</option>
      </select>
      {custom && (
        <fieldset>
          <legend>사용자 지정 크기</legend>
          <label>
            너비
            <input
              type="number"
              min={64}
              step={64}
              value={w}
              onChange={(e) => setW(e.target.value)}
            />
          </label>
          <label>
            높이
            <input
              type="number"
              min={64}
              step={64}
              value={h}
              onChange={(e) => setH(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={!allowedSize(Number(w), Number(h))}
            onClick={() => setResolution(`${Number(w)}x${Number(h)}`)}
          >
            크기 적용
          </button>
        </fieldset>
      )}
    </>
  );
}
