const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act, create } = require('react-test-renderer');
const { hasActiveCharacterPrompt } = require('../workspaceCharacterInput');
const Characters =
  require('../renderer/componenets/ConnectedCharacters').default;
const {
  createConnectedWorkspaceState,
} = require('../renderer/generation/connectedDraft');

function mount(t, draft) {
  let current = draft,
    renderer;
  const render = () =>
    React.createElement(Characters, {
      draft: current,
      onChange(patch) {
        current = { ...current, ...patch };
        renderer.update(render());
      },
    });
  act(() => {
    renderer = create(render());
  });
  t.after(() => act(() => renderer.unmount()));
  return {
    renderer,
    get draft() {
      return current;
    },
  };
}
const card = (id, prompt, negativePrompt = '') => ({
  id,
  enabled: true,
  prompt,
  negativePrompt,
  cell: { row: 2, column: 2 },
});

test('the shared positive-input predicate excludes empty/disabled cards without trimming or changing text', () => {
  const candidates = [
    card('empty', ''),
    card('space', ' \n '),
    card('negative', '', 'hat'),
    { ...card('off', 'person'), enabled: false },
    card('ready', ' person '),
  ];
  const before = structuredClone(candidates);
  assert.deepEqual(
    candidates.filter(hasActiveCharacterPrompt).map((c) => c.id),
    ['ready'],
  );
  assert.deepEqual(candidates, before);
});

test('a new blank card shows waiting state; positive text activates it and deleting that text preserves its negative draft', (t) => {
  const f = mount(t, createConnectedWorkspaceState().draft);
  act(() =>
    f.renderer.root
      .findByProps({ 'data-testid': 'add-live-character' })
      .props.onClick(),
  );
  const id = f.draft.characters[0].id;
  assert.ok(f.renderer.root.findByProps({ 'data-character-waiting': id }));
  assert.ok(JSON.stringify(f.renderer.toJSON()).includes('작성 대기 1'));
  act(() =>
    f.renderer.root
      .findByProps({ 'data-character-negative': id })
      .props.onChange({ target: { value: 'hat' } }),
  );
  assert.ok(
    JSON.stringify(f.renderer.toJSON()).includes('아직 전송하지 않습니다'),
  );
  act(() =>
    f.renderer.root
      .findByProps({ 'data-character-prompt': id })
      .props.onChange({ target: { value: 'person' } }),
  );
  assert.equal(
    f.renderer.root.findAllByProps({ 'data-character-waiting': id }).length,
    0,
  );
  assert.equal(f.draft.characters.filter(hasActiveCharacterPrompt).length, 1);
  act(() =>
    f.renderer.root
      .findByProps({ 'data-character-prompt': id })
      .props.onChange({ target: { value: '' } }),
  );
  assert.equal(f.draft.characters[0].negativePrompt, 'hat');
  assert.ok(f.renderer.root.findByProps({ 'data-character-waiting': id }));
});

test('waiting-card deletion undo works alongside22 ready characters and never consumes a generation slot', (t) => {
  const draft = createConnectedWorkspaceState().draft;
  draft.characters = [
    ...Array.from({ length: 22 }, (_, i) => card(`ready${i}`, 'person')),
    card('waiting', ''),
  ];
  const f = mount(t, draft);
  act(() =>
    f.renderer.root
      .findByProps({ 'data-character-delete': 'waiting' })
      .props.onClick(),
  );
  const undo = f.renderer.root.findByProps({
    'data-testid': 'undo-live-character',
  });
  assert.equal(undo.props.disabled, false);
  act(() => undo.props.onClick());
  assert.equal(f.draft.characters.length, 23);
  assert.equal(f.draft.characters.filter(hasActiveCharacterPrompt).length, 22);
  assert.ok(
    f.renderer.root.findByProps({ 'data-character-waiting': 'waiting' }),
  );
});

test('disabled cards retain their text; V4.5 still offers a disable action for enabled waiting drafts', (t) => {
  const draft = createConnectedWorkspaceState('v4.5').draft;
  draft.characters = [card('waiting', '', 'hat')];
  const f = mount(t, draft);
  act(() =>
    f.renderer.root
      .findByProps({ 'data-testid': 'disable-live-characters' })
      .props.onClick(),
  );
  assert.equal(f.draft.characters[0].enabled, false);
  assert.equal(f.draft.characters[0].negativePrompt, 'hat');
  assert.equal(
    f.renderer.root.findAllByProps({ 'data-character-waiting': 'waiting' })
      .length,
    0,
  );
});
