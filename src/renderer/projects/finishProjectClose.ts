/* eslint import/prefer-default-export: off */
export async function finishProjectClose(
  finish: () => Promise<boolean>,
  notify: (message: string) => void,
) {
  const accepted = await finish();
  if (!accepted)
    notify(
      '닫기 상태가 변경됐습니다. 입력은 유지됩니다. 닫기를 다시 눌러 주세요.',
    );
  return accepted;
}
