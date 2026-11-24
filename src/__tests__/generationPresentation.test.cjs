const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  generationMessage,
  availableQueueSceneIds,
  requiresAnlasWarning,
  ANLAS_STEP_WARNING,
} = require('../renderer/generation/generationPresentation');
test('only settings above28 require the extra Anlas warning, including a mixed queue', () => {
  for (const steps of [1, 23, 28])
    assert.equal(requiresAnlasWarning({ steps }), false);
  for (const steps of [29, 50])
    assert.equal(requiresAnlasWarning({ steps }), true);
  assert.equal([{ steps: 28 }, { steps: 29 }].some(requiresAnlasWarning), true);
  assert.equal(
    [{ steps: 23 }, { steps: 28 }].some(requiresAnlasWarning),
    false,
  );
  assert.match(ANLAS_STEP_WARNING, /Anlas/);
});
test('changed/deleted queue input names the locally known scene while no server body or prompt is used', () => {
  const error = {
    ok: false,
    code: 'QUEUE_INPUT_CHANGED',
    mayHaveReachedServer: false,
    conflictSceneId: 'scene-2',
    message: 'raw server secret',
  };
  const text = generationMessage(error, [
    { id: 'scene-2', name: '저녁의 정원' },
  ]);
  assert.ok(text.includes('저녁의 정원'));
  assert.ok(text.includes('입력'));
  assert.ok(!text.includes('다른 저장'));
  assert.ok(!text.includes(error.message));
  assert.ok(generationMessage(error).includes('예약한 씬'));
  assert.ok(!generationMessage(error).includes('undefined'));
});
test('deleted scene selections are excluded immediately; stable selections retain identity and order', () => {
  const ids = ['scene-1', 'deleted', 'scene-3'],
    scenes = [{ id: 'scene-1' }, { id: 'scene-3' }];
  assert.deepEqual(availableQueueSceneIds(ids, scenes), ['scene-1', 'scene-3']);
  assert.deepEqual(ids, ['scene-1', 'deleted', 'scene-3']);
  const kept = ['scene-3', 'scene-1'];
  assert.equal(availableQueueSceneIds(kept, scenes), kept);
  assert.deepEqual(availableQueueSceneIds(ids, []), []);
});
test('transport status mapping and server-processing uncertainty are retained', () => {
  assert.ok(
    generationMessage({
      code: 'HTTP_ERROR',
      httpStatus: 429,
      mayHaveReachedServer: true,
    }).includes('자동 재시도하지 않습니다'),
  );
  assert.ok(
    generationMessage({
      code: 'CANCELLED',
      mayHaveReachedServer: true,
    }).includes('소모됐을 수'),
  );
});
test('current stopped item wins over older429; result-pending is immediate even without a matching stop pointer', () => {
  const {
    queueOutcome,
  } = require('../renderer/generation/generationPresentation');
  const items = [
    {
      id: 'old',
      status: 'failed',
      error: {
        ok: false,
        code: 'HTTP_ERROR',
        httpStatus: 429,
        mayHaveReachedServer: true,
      },
    },
    {
      id: 'now',
      status: 'failed',
      error: { ok: false, code: 'TIMEOUT', mayHaveReachedServer: true },
    },
  ];
  assert.equal(
    queueOutcome({ items, stoppedItemId: 'now' }).error.code,
    'TIMEOUT',
  );
  assert.equal(queueOutcome({ items }).error, undefined);
  items[1] = {
    id: 'now',
    status: 'result-pending',
    error: {
      ok: false,
      code: 'RESULT_SAVE_FAILED',
      pendingResult: true,
      projectCode: 'PROJECT_SERVICE_STOPPED',
      mayHaveReachedServer: true,
    },
  };
  const outcome = queueOutcome({ items, stoppedItemId: 'now' });
  assert.equal(outcome.error.code, 'RESULT_SAVE_FAILED');
  assert.equal(outcome.pending, true);
  assert.equal(outcome.storageStopped, true);
  assert.equal(queueOutcome({ items, stoppedItemId: 'unknown' }).pending, true);
  assert.equal(
    queueOutcome({ items, stoppedItemId: 'unknown' }).error,
    undefined,
  );
});
test('resolved or skipped items cannot become current errors even if a stale pointer is presented', () => {
  const {
    queueOutcome,
  } = require('../renderer/generation/generationPresentation');
  for (const status of ['done', 'preparing', 'running', 'skipped'])
    assert.equal(
      queueOutcome({
        items: [{ id: 'old', status, error: { code: 'TIMEOUT' } }],
        stoppedItemId: 'old',
      }).error,
      undefined,
    );
});
