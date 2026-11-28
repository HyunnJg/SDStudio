const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act, create } = require('react-test-renderer');
const Reference = require('../renderer/componenets/ConnectedReference').default;
const Library = require('../renderer/componenets/PromptLibrary').default;
const { createConnectedWorkspaceState } = require('../renderer/generation/connectedDraft');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const reference = { id: '11111111-1111-4111-8111-111111111111', uploadHash: 'a'.repeat(64), sourceHash: 'b'.repeat(64), sourceBytes: 80, uploadBytes: 90, width: 832, height: 1216, role: 'character', strength: 1, preferSameOutfit: true };
async function panel(t, extra = {}) {
  const changes = [], files = [];
  const props = { references: [reference], supportsReferences: true, projectId: '11111111-1111-4111-8111-111111111111', sceneId: 'scene-1', family: 'v5', locked: false, preview: undefined,
    client: { referenceImage: async () => ({ ok: false, code: 'PROJECT_CORRUPT' }) }, onChange: (refs) => changes.push(refs), onFile: async (f) => files.push(f), ...extra };
  let renderer;
  await act(async () => { renderer = create(React.createElement(Reference, props)); await tick(); });
  t.after(() => act(() => renderer.unmount()));
  return { renderer, changes, files };
}
test('reference panel exposes separate local PNG selection, cost, current role/strength and missing-file notice', async (t) => {
  const f = await panel(t), text = JSON.stringify(f.renderer.toJSON());
  assert.ok(text.includes('5 Anlas')); assert.ok(text.includes('이미지 입력'));
  assert.ok(text.includes('참조 없이 자동 생성하지 않습니다'));
  assert.equal(f.renderer.root.findByProps({ 'data-testid': 'choose-reference' }).props.disabled, false);
});
test('switching to style clears the outfit-only toggle, strength and remove are explicit draft changes', async (t) => {
  const f = await panel(t);
  act(() => f.renderer.root.findByProps({ 'data-testid': 'reference-role' }).props.onChange({ target: { value: 'style' } }));
  assert.equal(f.changes[0][0].preferSameOutfit, false); assert.equal(f.changes[0][0].id, reference.id);
  act(() => f.renderer.root.findByProps({ 'data-testid': 'reference-strength' }).props.onChange({ target: { value: '4.2' } }));
  assert.equal(f.changes[1][0].strength, 4.2);
  act(() => f.renderer.root.findByProps({ 'data-testid': 'remove-reference' }).props.onClick());
  assert.deepEqual(f.changes[2], []); assert.equal(f.files.length, 0);
});
test('V4.5 preserves the reference and offers removal instead of silently dropping it; busy selection/drop does nothing', async (t) => {
  const f = await panel(t, { family: 'v4.5', supportsReferences: false, locked: true });
  assert.equal(f.renderer.root.findByProps({ 'data-testid': 'choose-reference' }).props.disabled, true);
  let prevented = 0;
  act(() => f.renderer.root.findByProps({ 'data-testid': 'reference-panel' }).props.onDrop({ preventDefault: () => prevented++, stopPropagation: () => prevented++, dataTransfer: { files: [{}] } }));
  assert.equal(f.files.length, 0); assert.equal(prevented, 2); assert.equal(f.changes.length, 0);
});
test('three reference cards address previews by UUID and edit, remove or move just one card', async (t) => {
  const outfit = { ...reference, id: '22222222-2222-4222-8222-222222222222', role: 'outfit', preferSameOutfit: false };
  const style = { ...outfit, id: '33333333-3333-4333-8333-333333333333', role: 'style' };
  const refs = [reference, outfit, style], reads = [], replacements = [];
  const f = await panel(t, { references: refs, client: {
    referenceImage: async (...args) => { reads.push(args); return {ok:false}; },
  }, onReplace: (file, id) => replacements.push([file,id]) });
  assert.deepEqual(reads.map((args) => args.slice(2)), refs.map(r => ['reference', r.id]));
  assert.ok(JSON.stringify(f.renderer.toJSON()).includes('+15 Anlas'));
  const card = f.renderer.root.findByProps({'data-reference-id':outfit.id});
  act(() => card.findByProps({'data-testid':'reference-strength-2'}).props.onChange({target:{value:'3.2'}}));
  assert.deepEqual(f.changes[0], [reference, { ...outfit, strength:3.2 }, style]);
  act(() => card.findAllByType('button').find(b => b.children.includes('앞으로')).props.onClick());
  assert.deepEqual(f.changes[1], [outfit,reference,style]);
  act(() => card.findByProps({'data-testid':'remove-reference-2'}).props.onClick());
  assert.deepEqual(f.changes[2], [reference, style]);
  const file = {};
  act(() => card.props.onDrop({preventDefault(){},stopPropagation(){},dataTransfer:{files:[file]}}));
  assert.deepEqual(replacements, [[file, outfit.id]]);
});
test('a full four-card scene shows the per-card price and keeps variation available in the file chooser', async (t) => {
  const refs = Array.from({length: 4}, (_, i) => ({...reference, id: String(i)}));
  const {renderer} = await panel(t, {references: refs});
  const text = JSON.stringify(renderer.toJSON());
  assert.ok(text.includes('+20 Anlas'));
  assert.ok(text.includes('같은 이미지가 여러 카드'));
  assert.ok(text.includes('씬당 4장'));
  const Choice = require('../renderer/componenets/WorkspaceImageChoice').default;
  let chooser;
  act(() => { chooser = create(React.createElement(Choice, {
    file: {name:'sample.png'}, canReference:true, canVariation:true, referenceLimitReached:true,
  }), {createNodeMock: () => ({showModal(){}})}); });
  t.after(() => act(() => chooser.unmount()));
  assert.equal(chooser.root.findByProps({'data-testid':'image-use-reference'}).props.disabled, true);
  assert.equal(chooser.root.findByProps({'data-testid':'image-use-variation'}).props.disabled, false);
});
test('legacy mixed import shows valid candidates and skipped count instead of losing the whole file', async (t) => {
  const draft = createConnectedWorkspaceState().draft;
  let renderer;
  await act(async () => { renderer = create(React.createElement(Library, { client: { read: async () => ({ ok: true, value: { revision: 'a'.repeat(64), entries: [] } }) }, draft, kind: 'main', locked: false, onApply() {}, onClose() {}, onGuard() {}, onLegacy() {} }), { createNodeMock: () => ({ showModal() {} }) }); await tick(); });
  t.after(() => act(() => renderer.unmount()));
  const valid = { name: 'Synthetic import', frontPrompt: '<hair>, {red|blue}', backPrompt: '', uc: '' };
  const encoded = Buffer.from(JSON.stringify({ presets: { SDImageGen: [valid, { ...valid, name: '' }] } }));
  await act(async () => { renderer.root.findByProps({ 'aria-label': '기존 V3 세션 JSON' }).props.onChange({ target: { files: [{ size: encoded.length, arrayBuffer: async () => encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) }], value: '' } }); await tick(); });
  const text = JSON.stringify(renderer.toJSON());
  assert.ok(text.includes('1개는 이름·길이·텍스트 형식 문제로 제외')); assert.ok(text.includes('Synthetic import'));
  assert.ok(text.includes('V3 조각은 작업실에서 모음 JSON을 가져오세요'));
});
