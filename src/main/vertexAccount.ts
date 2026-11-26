import { createPrivateKey, sign } from 'crypto';
import { NaiError } from './nai/errors';

import readVibeJSON from './vibeResponse';

const tokenURL = 'https://oauth2.googleapis.com/token';

export function normalizeVertexAccount(value: unknown): string {
  try {
    if (typeof value !== 'string' || value.length > 16384) throw Error();
    const a = JSON.parse(value.trim());
    if (
      (a.type !== undefined && a.type !== 'service_account') ||
      (a.universe_domain !== undefined &&
        a.universe_domain !== 'googleapis.com') ||
      (a.token_uri !== undefined && a.token_uri !== tokenURL) ||
      typeof a.project_id !== 'string' ||
      !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(a.project_id) ||
      typeof a.client_email !== 'string' ||
      !/^[a-z0-9._+-]+@[a-z0-9.-]+\.gserviceaccount\.com$/i.test(
        a.client_email,
      ) ||
      (a.private_key_id !== undefined &&
        (typeof a.private_key_id !== 'string' ||
          !/^[a-z0-9_-]{1,128}$/i.test(a.private_key_id))) ||
      typeof a.private_key !== 'string'
    )
      throw Error();
    const pem = a.private_key.trim().replace(/\\n/g, '\n');
    if (!pem.startsWith('-----BEGIN PRIVATE KEY-----')) throw Error();
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== 'rsa') throw Error();
    const normalized = JSON.stringify({
      project_id: a.project_id,
      client_email: a.client_email,
      private_key: key.export({ format: 'pem', type: 'pkcs8' }),
      private_key_id: a.private_key_id,
    });
    if (normalized.length > 6200) throw Error();
    return normalized;
  } catch {
    throw new NaiError('INVALID_INPUT');
  }
}

export async function vertexAuthorization(
  value: string,
  send: typeof fetch,
  signal: AbortSignal,
) {
  const a = JSON.parse(normalizeVertexAccount(value));
  const now = Math.floor(Date.now() / 1000);
  const encode = (part: object) =>
    Buffer.from(JSON.stringify(part)).toString('base64url');
  const header = encode({ alg: 'RS256', typ: 'JWT', kid: a.private_key_id });
  const payload = encode({
    iss: a.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: tokenURL,
    iat: now,
    exp: now + 3600,
  });
  const unsigned = `${header}.${payload}`;
  const assertion = `${unsigned}.${sign(
    'RSA-SHA256',
    Buffer.from(unsigned),
    a.private_key,
  ).toString('base64url')}`;
  const response = await send(tokenURL, {
    method: 'POST',
    redirect: 'error',
    signal,
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`OAuth HTTP ${response.status}`);
  }
  const { access_token: token, token_type: type } = await readVibeJSON(
    response,
    16384,
  );
  if (
    type?.toLowerCase() !== 'bearer' ||
    typeof token !== 'string' ||
    !/^[\x21-\x7e]{1,8192}$/.test(token)
  )
    throw Error();
  return { project: a.project_id as string, token };
}
