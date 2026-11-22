/* Browser script for the diagnostic window; no Node or broad IPC access. */
const $ = (id) => document.getElementById(id);
let snapshot,
  configured = false,
  busy = false;
const messages = {
  HTTP_ERROR:
    '서버가 요청을 거부했습니다. 상태 기록과 비공개 응답을 확인하세요. 자동 재시도하지 않습니다.',
  RESPONSE_CAPTURE_FAILED:
    '응답 원문을 보관하지 못했습니다. 서버 처리 가능성이 있어 재전송하지 않습니다.',
  INVALID_IMAGE_RESPONSE:
    '이미지 응답 검증에 실패했습니다. 보관한 파일을 로컬에서 재검사할 수 있습니다.',
  RESPONSE_FORMAT: '예상한 응답 형식과 다릅니다. 비공개 응답을 확인하세요.',
  CANCELLED: '중지했습니다. 이미 서버가 처리했을 수 있습니다.',
  TIMEOUT: '기한이 지났습니다. 이미 서버가 처리했을 수 있습니다.',
  TOKEN_MISSING: '이번 창에서 사용할 토큰을 먼저 입력해 주세요.',
  ALREADY_USED: '이 프로필의 전송 시도는 이미 사용했습니다.',
  COST_EVIDENCE_REQUIRED: '실행 전 잔액·비용과 같은 설정 확인이 필요합니다.',
  COST_LIMIT: '표시 비용이 10 Anlas 상한을 넘습니다.',
  BALANCE_LOW: '잔액이 표시 비용보다 적습니다.',
  CAPTURE_REQUIRED: '실패 응답 재검사를 위해 비공개 보관을 선택해 주세요.',
  REQUEST_CHANGED: '확인한 요청과 현재 요청이 다릅니다. 다시 확인하세요.',
  STORAGE_FAILED:
    '테스트 파일을 보관하거나 기록하지 못했습니다. 자동 재시도하지 않습니다.',
  OFFLINE: '오프라인 강제 설정이 적용되어 있습니다.',
  INVALID_INPUT: '토큰 형식을 확인해 주세요.',
  UNTRUSTED_SENDER: '이 창에서는 요청할 수 없습니다.',
  NOT_FINISHED: '현재 요청이 진행 중이거나 기록할 시도가 없습니다.',
};
function refresh() {
  $('run').disabled =
    busy || !configured || !snapshot || snapshot.used || snapshot.offline;
  $('cancel').disabled = !busy;
  $('token-save').disabled = busy || snapshot?.used || snapshot?.offline;
  $('token').disabled = busy || snapshot?.used || snapshot?.offline;
  $('after-save').disabled = busy || !snapshot?.canRecordBalance;
}
async function load() {
  const value = await window.validation.status();
  if (!value.ok) {
    $('message').textContent = messages[value.code] || value.code;
    return;
  }
  snapshot = value.status;
  configured = snapshot.tokenConfigured === true;
  if (snapshot.used)
    $('token-state').textContent = '전송 시도 사용됨 · 토큰 메모리 사본 삭제';
  $('candidate').textContent = JSON.stringify(snapshot.candidate, null, 2);
  if (snapshot.used) $('message').textContent = messages.ALREADY_USED;
  $('recovery-state').textContent = snapshot.incomplete
    ? '결과 기록이 없습니다. 다른 실행 창이 모두 종료됐는지 확인한 뒤 현재 웹 잔액을 기록하세요. 서버 처리·과금 여부는 미확인입니다.'
    : '';
  refresh();
}
$('token-save').onclick = async () => {
  const raw = $('token').value;
  const token = raw.trim();
  const value = await window.validation.setToken(token);
  if (value.ok) {
    configured = true;
    $('token').value = '';
    $('token-state').textContent =
      '이번 창에만 보관 중 · 서버 인증 미확인' +
      (raw === token ? '' : ' · 앞뒤 공백 제거');
  } else $('message').textContent = messages[value.code] || value.code;
  refresh();
};
$('run').onclick = async () => {
  if (busy || !snapshot || snapshot.used) return;
  busy = true;
  refresh();
  $('message').textContent = '';
  const number = (id) =>
    $(id).value.trim() === '' ? undefined : Number($(id).value);
  try {
    const value = await window.validation.run({
      requestHash: snapshot.requestHash,
      beforeBalance: number('before'),
      displayedCost: number('cost'),
      sameSettings: $('same').checked,
      capture: $('capture').checked,
      candidateAcknowledged: $('ack').checked,
    });
    $('result').textContent = JSON.stringify(value, null, 2);
    if (!value.ok)
      $('message').textContent = messages[value.code] || value.code;
  } catch {
    $('message').textContent =
      '요청 상태를 확인하지 못했습니다. 자동 재시도하지 마세요.';
  } finally {
    busy = false;
    await load();
    refresh();
  }
};
$('cancel').onclick = () => window.validation.cancel();
$('after-save').onclick = async () => {
  const value = await window.validation.after(
    $('after').value.trim() === '' ? undefined : Number($('after').value),
  );
  $('message').textContent = value.ok
    ? '실행 후 잔액을 기록했습니다.'
    : messages[value.code] || value.code;
};
window.addEventListener('beforeunload', () => {
  $('token').value = '';
});
load();
