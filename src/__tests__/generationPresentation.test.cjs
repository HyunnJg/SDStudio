const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  generationMessage,
  availableQueueSceneIds,
} = require('../renderer/generation/generationPresentation');
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
