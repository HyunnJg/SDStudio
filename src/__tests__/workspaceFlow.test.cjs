const { test } = require('node:test');
const assert = require('node:assert/strict');
const React = require('react');
const { act, create } = require('react-test-renderer');
const confirm = require('../renderer/generation/workspaceUx').default;
const { presetTextKey, matchingPreset } = require('../renderer/generation/presetPresentation');
const Choice = require('../renderer/componenets/WorkspaceImageChoice').default;
const { createConnectedWorkspaceState } = require('../renderer/generation/connectedDraft');

test('reference cost requires first session acknowledgement; high steps remain a separate repeated confirmation', () => {
  assert.equal(confirm({steps:28},false),false);
  assert.equal(confirm({steps:28,reference:{}},false),true);
  assert.equal(confirm({steps:28,reference:{}},true),false);
  assert.equal(confirm({steps:29,reference:{}},true),true);
  assert.equal(confirm({steps:29},true),true);
});
test('image purpose selection has no implicit import or upload and unavailable reference stays disabled', () => {
  const actions=[]; let r;
  act(()=> {r=create(React.createElement(Choice,{file:{name:'synthetic.png'},canReference:false,onMetadata:()=>actions.push('metadata'),onReference:()=>actions.push('reference'),onClose:()=>actions.push('close')}),{createNodeMock:()=>({showModal(){}})});});
  assert.deepEqual(actions,[]);
  assert.equal(r.root.findByProps({'data-testid':'image-use-reference'}).props.disabled,true);
  act(()=>r.root.findByProps({'data-testid':'image-use-metadata'}).props.onClick());
  assert.deepEqual(actions,['metadata']);
  act(()=>r.unmount());
});
test('preset badge matches saved text and kind, excludes trash, and follows preset settings without following seed', () => {
  const draft=createConnectedWorkspaceState().draft;
  const main={id:'1',name:'Saved main',kind:'main',prompt:draft.prompt,negativePrompt:draft.negativePrompt,qualityTags:draft.qualityTags??'none',ucPreset:draft.ucPreset??'none',deleted:false};
  assert.equal(matchingPreset([main],draft).name,main.name);
  assert.equal(matchingPreset([{...main,deleted:true}],draft),undefined);
  assert.equal(matchingPreset([{...main,kind:'character'}],draft),undefined);
  const key=presetTextKey(draft);
  assert.equal(presetTextKey({...draft,seed:'789',steps:29}),key);
  assert.notEqual(presetTextKey({...draft,prompt:draft.prompt+' changed'}),key);
  assert.equal(matchingPreset([main],{...draft,qualityTags:main.qualityTags==='none'?'standard':'none'}),undefined);
});
test('character preset marker follows only that character text, preserving unrelated card and scene edits', () => {
  const draft=createConnectedWorkspaceState().draft;
  draft.characters=[{id:'a',prompt:'coat',negativePrompt:'hat',enabled:true},{id:'b',prompt:'different',negativePrompt:'',enabled:true}];
  const p={id:'2',kind:'character',name:'Coat',prompt:'coat',negativePrompt:'hat',deleted:false};
  assert.equal(matchingPreset([p],draft,'a').name,'Coat');
  assert.equal(matchingPreset([p],draft,'b'),undefined);
  const key=presetTextKey(draft,'a');
  assert.equal(presetTextKey({...draft,prompt:'new scene',characters:[{...draft.characters[0],enabled:false},draft.characters[1]]},'a'),key);
  assert.notEqual(presetTextKey({...draft,characters:[{...draft.characters[0],prompt:'new coat'}]},'a'),key);
});
