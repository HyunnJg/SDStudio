/* eslint jsx-a11y/label-has-associated-control: ["error", { "assert": "either" }] */
import { useState } from 'react';
import type { RefObject } from 'react';

export async function readAccountFields(form: HTMLFormElement) {
  const data = new FormData(form);
  if (data.has('json')) return String(data.get('json')).trim();
  if (data.has('file')) {
    const file = data.get('file');
    if (!(file instanceof File) || !file.size || file.size > 16384) return '';
    return (await file.text()).trim();
  }
  return JSON.stringify({
    project_id: String(data.get('project_id') ?? '').trim(),
    client_email: String(data.get('client_email') ?? '').trim(),
    private_key: String(data.get('private_key') ?? '').trim(),
    private_key_id:
      String(data.get('private_key_id') ?? '').trim() || undefined,
  });
}

export default function VertexAccountFields({
  form,
}: {
  form: RefObject<HTMLFormElement>;
}) {
  const [mode, setMode] = useState('json');
  return (
    <>
      <label>
        서비스 계정 입력 방식
        <select value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="json">JSON 붙여넣기</option>
          <option value="file">JSON 파일 선택</option>
          <option value="fields">필요한 필드 입력</option>
        </select>
      </label>
      <form
        key={mode}
        ref={form}
        autoComplete="off"
        onSubmit={(e) => e.preventDefault()}
      >
        {mode === 'json' && (
          <label>
            서비스 계정 JSON
            <textarea
              rows={3}
              spellCheck={false}
              name="json"
              maxLength={16384}
            />
          </label>
        )}
        {mode === 'file' && (
          <label>
            서비스 계정 JSON 파일
            <input name="file" type="file" accept=".json,application/json" />
          </label>
        )}
        {mode === 'fields' && (
          <>
            <label>
              프로젝트 ID (project_id)
              <input name="project_id" maxLength={30} />
            </label>
            <label>
              서비스 계정 이메일 (client_email)
              <input name="client_email" type="email" maxLength={254} />
            </label>
            <label>
              개인 키 (private_key)
              <textarea
                name="private_key"
                rows={3}
                spellCheck={false}
                maxLength={6200}
              />
            </label>
            <label>
              키 ID (선택 · private_key_id)
              <input name="private_key_id" maxLength={128} />
            </label>
          </>
        )}
      </form>
      <small>
        Vertex AI를 활성화한 프로젝트에 앱 전용 서비스 계정을 만들고 모델 호출에
        필요한 권한만 부여하세요. 기본 제공 역할은 Vertex AI 사용자
        (roles/aiplatform.user)를 권장합니다. 프로젝트 소유자·편집자 키는
        피하고, 등록 후 원본 JSON은 다운로드 폴더에서 안전한 보관 위치로
        옮기세요.
      </small>
    </>
  );
}
