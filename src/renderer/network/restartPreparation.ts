/* eslint import/prefer-default-export: off */
export async function prepareRestart(
  busy: () => boolean,
  save: () => Promise<void>,
): Promise<'JOBS_PENDING' | 'SAVE_FAILED' | undefined> {
  if (busy()) return 'JOBS_PENDING';
  try {
    await save();
  } catch {
    return 'SAVE_FAILED';
  }
  return busy() ? 'JOBS_PENDING' : undefined;
}
