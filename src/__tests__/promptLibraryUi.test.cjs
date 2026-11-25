const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act, create } = require('react-test-renderer');
const Library = require('../renderer/componenets/PromptLibrary').default;
const Characters =
  require('../renderer/componenets/ConnectedCharacters').default;
const {
  createConnectedWorkspaceState,
} = require('../renderer/generation/connectedDraft');
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function fixture(t) {
  const draft = createConnectedWorkspaceState().draft;
  let snapshot = { revision: '0'.repeat(64), entries: [] },
    saves = 0,
    applied = [],
    closed = 0;
  const guards = [];
  const client = {
    read: async () => ({ ok: true, value: snapshot }),
    save: async (_rev, content, id) => {
      saves++;
      snapshot = {
        revision: 'a'.repeat(64),
        entries: [
          {
            ...content,
            id: id ?? '11111111-1111-1111-1111-111111111111',
            deleted: false,
          },
        ],
      };
      return { ok: true, value: snapshot };
    },
  };
  let renderer;
  await act(async () => {
    renderer = create(
      React.createElement(Library, {
        client,
        draft,
        kind: 'main',
        locked: false,
        onApply: (value) => applied.push(value),
        onClose: () => closed++,
        onGuard: (value) => guards.push(value),
        onLegacy() {},
      }),
      {
        createNodeMock: (e) =>
          e.type === 'dialog' ? { showModal() {} } : null,
      },
    );
    await tick();
  });
  t.after(() => act(() => renderer.unmount()));
  return {
    renderer,
    guards,
    get saves() {
      return saves;
    },
    get applied() {
      return applied;
    },
    get closed() {
      return closed;
    },
  };
}
test('saving a library preset never applies it or generates; application remains an explicit separate action', async (t) => {
  const f = await fixture(t);
  act(() =>
    f.renderer.root
      .findByProps({ 'data-testid': 'library-name' })
      .props.onChange({ target: { value: 'synthetic' } }),
  );
  assert.equal(f.guards.at(-1), true);
  await act(async () => {
    f.renderer.root
      .findByProps({ 'data-testid': 'library-save' })
      .props.onClick();
    await tick();
  });
  assert.equal(f.saves, 1);
  assert.equal(f.applied.length, 0);
  assert.equal(f.guards.at(-1), false);
  act(() =>
    f.renderer.root
      .findByProps({ 'data-testid': 'library-apply' })
      .props.onClick(),
  );
  assert.equal(f.applied.length, 1);
  assert.equal(f.saves, 1);
});
test('dirty library close asks inside the dialog and append leaves preset application unchecked', async (t) => {
  const f = await fixture(t);
  act(() =>
    f.renderer.root
      .findByProps({ 'data-testid': 'library-name' })
      .props.onChange({ target: { value: 'unsaved' } }),
  );
  act(() =>
    f.renderer.root
      .findByProps({ 'data-testid': 'library-mode' })
      .props.onChange({ target: { value: 'append' } }),
  );
  assert.equal(
    f.renderer.root.findByProps({ 'data-testid': 'library-apply-presets' })
      .props.checked,
    false,
  );
  act(() =>
    f.renderer.root
      .findByProps({ 'data-testid': 'library-close' })
      .props.onClick(),
  );
  assert.equal(f.closed, 0);
  act(() =>
    f.renderer.root
      .findByProps({ 'data-testid': 'library-discard-edit' })
      .props.onClick(),
  );
  assert.equal(f.closed, 1);
  assert.equal(f.saves, 0);
});
test('a library read completing after unmount does not resurrect UI state or its close guard', async () => {
  let resolve, renderer;
  const guards = [];
  await act(async () => {
    renderer = create(
      React.createElement(Library, {
        client: {
          read: () =>
            new Promise((r) => {
              resolve = r;
            }),
        },
        draft: createConnectedWorkspaceState().draft,
        kind: 'main',
        locked: false,
        onApply() {},
        onClose() {},
        onLegacy() {},
        onGuard: (v) => guards.push(v),
      }),
      { createNodeMock: () => ({ showModal() {} }) },
    );
  });
  act(() => renderer.unmount());
  await act(async () => {
    resolve({ ok: true, value: { revision: '0'.repeat(64), entries: [] } });
    await tick();
  });
  assert.equal(guards.at(-1), false);
});

test('a deferred trash switch captures the requested value before controlled DOM restores its checkbox', async (t) => {
  const f = await fixture(t);
  act(() =>
    f.renderer.root
      .findByProps({ 'data-testid': 'library-name' })
      .props.onChange({ target: { value: 'unsaved' } }),
  );
  const target = { checked: true };
  act(() =>
    f.renderer.root
      .findByProps({ 'data-testid': 'library-trash' })
      .props.onChange({ target }),
  );
  target.checked = false;
  act(() =>
    f.renderer.root
      .findByProps({ 'data-testid': 'library-discard-edit' })
      .props.onClick(),
  );
  assert.equal(
    f.renderer.root.findByProps({ 'data-testid': 'library-trash' }).props
      .checked,
    true,
  );
  assert.equal(f.saves, 0);
});
test('23 positive cards show a local warning before generation and preserve every draft', () => {
  const draft = createConnectedWorkspaceState().draft;
  draft.characters = Array.from({ length: 23 }, (_, i) => ({
    id: `c${i}`,
    prompt: 'person',
    negativePrompt: '',
    enabled: true,
    cell: { row: 2, column: 2 },
  }));
  const before = structuredClone(draft);
  let renderer;
  act(() => {
    renderer = create(
      React.createElement(Characters, { draft, onChange() {} }),
    );
  });
  assert.equal(
    renderer.root.findByProps({ 'data-testid': 'character-limit-warning' })
      .props.role,
    'alert',
  );
  assert.deepEqual(draft, before);
  act(() => renderer.unmount());
});
