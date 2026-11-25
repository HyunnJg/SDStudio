const {test}=require('node:test');
const assert=require('node:assert/strict');
const React=require('react');
const {act,create}=require('react-test-renderer');
const {ProjectController}=require('../renderer/projects/projectController');
const {createWorkspaceState}=require('../renderer/preview/workspaceDraft');
const Dialog=require('../renderer/componenets/WorkspaceResultTrash').default;
function fixture(){
 let state=createWorkspaceState(), busy=false, trashed=false,calls=0;
 const id='11111111-1111-4111-8111-111111111111';
 const snapshot={project:{id,name:'Saved synthetic',selectedSceneId:state.selectedSceneId,scenes:state.scenes,images:[]},revision:'a'.repeat(64)};
 const c=new ProjectController({workspace:()=>state,busy:()=>busy,reset:()=>{state=createWorkspaceState()},apply:s=>{state={...createWorkspaceState(),scenes:s.project.scenes,selectedSceneId:s.project.selectedSceneId,draft:s.project.scenes[0].draft}},client:{open:async()=>({ok:true,value:snapshot}),trashProject:async()=>{calls++;trashed=true;return{ok:true}},restoreProject:async()=>{calls++;trashed=false;return{ok:true}},list:async()=>({ok:true,value:trashed?[]:[{id,name:snapshot.project.name}]}),listTrash:async()=>({ok:true,value:trashed?[{id,name:snapshot.project.name}]:[]})}});
 return{c,id,get trashed(){return trashed},get calls(){return calls},busy:v=>busy=v,snapshot};
}
test('current project trash respects dirty cancel/discard and explicit undo reopens the saved identity',async()=>{
 const f=fixture();await f.c.open(f.id);f.c.setName('unsaved name');await f.c.trashProject(f.id);assert.ok(f.c.getSnapshot().confirm);assert.equal(f.calls,0);
 await f.c.confirm('cancel');assert.equal(f.c.getSnapshot().id,f.id);assert.equal(f.c.getSnapshot().name,'unsaved name');
 await f.c.trashProject(f.id);await f.c.confirm('discard');assert.equal(f.trashed,true);assert.equal(f.c.getSnapshot().id,undefined);assert.equal(f.c.getSnapshot().lastTrashedProject.id,f.id);
 await f.c.restoreProject(f.id,true);assert.equal(f.trashed,false);assert.equal(f.c.getSnapshot().id,f.id);assert.equal(f.c.getSnapshot().name,'Saved synthetic');assert.equal(f.c.getSnapshot().lastTrashedProject,undefined);
});
test('busy controller does not invoke trash, while a generated hidden result is kept separate from gallery records',async()=>{
 const f=fixture();await f.c.open(f.id);f.busy(true);await f.c.trashProject(f.id);assert.equal(f.calls,0);assert.equal(f.c.getSnapshot().id,f.id);f.busy(false);
 const image={id:'image-synthetic',seed:0,draft:f.snapshot.project.scenes[0].draft,pngBytes:1024};f.c.acceptGenerated({...f.snapshot,project:{...f.snapshot.project,images:[image],trashedImageIds:[image.id]}});
 assert.deepEqual(f.c.getSnapshot().imageRecords,[]);assert.deepEqual(f.c.getSnapshot().trashedImages,[image]);
});
test('result trash dialog keeps restoration failures visible and disables destructive actions while locked',()=>{
 let renderer;act(()=>{renderer=create(React.createElement(Dialog,{client:{image:async()=>({ok:false,code:'PROJECT_CORRUPT'})},revision:'a'.repeat(64),projectId:'11111111-1111-4111-8111-111111111111',images:[{id:'image-synthetic',seed:0}],locked:true,error:'Synthetic restore failure',onRestore(){throw Error('should not run')},onClose(){}}),{createNodeMock:()=>({showModal(){}})});});
 assert.equal(renderer.root.findByProps({'role':'alert'}).props.children,'Synthetic restore failure');assert.equal(renderer.root.findByProps({'data-restore-result':'image-synthetic'}).props.disabled,true);assert.equal(renderer.root.findByProps({'data-testid':'empty-result-trash'}).props.disabled,true);act(()=>renderer.unmount());
});

test('empty confirmation expires on revision change and explicit cancel does not invoke storage', () => {
  const calls = [];
  const props = {client:{}, projectId:'p', images:[], locked:false, error:'',
    revision:'a', onEmpty:revision=>calls.push(revision), onRestore(){}, onClose(){}};
  let renderer;
  act(() => {renderer = create(React.createElement(Dialog,props), {createNodeMock:()=>({showModal(){}})});});
  const click = id => act(() => renderer.root.findByProps({'data-testid':id}).props.onClick());
  click('empty-result-trash');
  act(() => renderer.update(React.createElement(Dialog,{...props,revision:'b'})));
  assert.equal(renderer.root.findAllByProps({'data-testid':'confirm-empty-result-trash'}).length,0);
  click('empty-result-trash');click('cancel-empty-result-trash');
  assert.deepEqual(calls,[]);
  click('empty-result-trash');click('confirm-empty-result-trash');
  assert.deepEqual(calls,['b']);
  act(()=> renderer.unmount());
});
