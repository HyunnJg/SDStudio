const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ProjectStore } = require('../main/projects/projectStore');
const { ProjectService } = require('../main/projects/projectService');
const { registerProjects } = require('../main/projects/projectIpc');
const { WorkspaceGeneration } = require('../main/nai/workspaceGeneration');
const { validateWorkspaceProject } = require('../workspaceProject');
const { createConnectedWorkspaceState } = require('../renderer/generation/connectedDraft');
const { snapshotWorkspaceScenes } = require('../renderer/preview/workspaceDraft');
const { png } = require('./fixtures/nai/png.cjs');
function fixture(t) {
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'sdstudio-trash-'));
 t.after(()=>fs.rmSync(profile,{recursive:true,force:true}));
 const state=createConnectedWorkspaceState('v4.5');
 const content={name:'synthetic trash',selectedSceneId:state.selectedSceneId,scenes:snapshotWorkspaceScenes(state)};
 const store=new ProjectStore(profile);
 const initial=store.create(content);
 const input={sceneId:content.selectedSceneId,model:'fixture-model-not-for-api',sampler:'fixture-sampler',noiseSchedule:'fixture-noise',seed:0,draft:content.scenes[0].draft};
 const snapshot=store.addPNG(initial.project.id,initial.revision,input,png());
 const id=snapshot.project.id, image=snapshot.project.images[0];
 const folder=path.join(profile,'projects-v1',id), trash=path.join(profile,'projects-v1','.trash',id);
 return {profile,store,content,input,snapshot,id,image,folder,trash};
}
test('result trash adds v6 state and immutable history while preserving original PNG, input and request record',t=>{
 const f=fixture(t), before=fs.readFileSync(path.join(f.folder,'project.json'));
 const hidden=f.store.setImageDeleted(f.id,f.snapshot.revision,f.image.id,true);
 assert.equal(hidden.project.version,6);assert.deepEqual(hidden.project.trashedImageIds,[f.image.id]);
 assert.deepEqual(hidden.project.images,f.snapshot.project.images);assert.deepEqual(hidden.project.scenes,f.snapshot.project.scenes);
 assert.deepEqual(fs.readFileSync(path.join(f.folder,'images',f.image.sha256+'.png')),png());
 assert.deepEqual(fs.readFileSync(path.join(f.folder,'history',f.snapshot.revision+'.json')),before);
 assert.deepEqual(new ProjectStore(f.profile).open(f.id),hidden);
 const same=f.store.setImageDeleted(f.id,hidden.revision,f.image.id,true);assert.equal(same.revision,hidden.revision);
 const restored=f.store.setImageDeleted(f.id,hidden.revision,f.image.id,false);
 assert.deepEqual(restored.project.trashedImageIds,[]);assert.equal(restored.project.version,6);
 assert.deepEqual(restored.project.images,f.snapshot.project.images);
});
test('result mutation rejects stale revisions, unknown IDs, nonboolean flags and invalid v6 ID sets',t=>{
 const f=fixture(t), hidden=f.store.setImageDeleted(f.id,f.snapshot.revision,f.image.id,true);
 assert.throws(()=>f.store.setImageDeleted(f.id,f.snapshot.revision,f.image.id,false),{code:'PROJECT_CONFLICT'});
 assert.throws(()=>f.store.setImageDeleted(f.id,hidden.revision,'11111111-1111-4111-8111-111111111111',false),{code:'PROJECT_NOT_FOUND'});
 assert.throws(()=>f.store.setImageDeleted(f.id,hidden.revision,f.image.id,'true'),{code:'PROJECT_INPUT'});
 for(const ids of [[f.image.id,f.image.id],['11111111-1111-4111-8111-111111111111'],['../escape']]) assert.throws(()=>validateWorkspaceProject({...hidden.project,trashedImageIds:ids}),{code:'PROJECT_CORRUPT'});
 assert.throws(()=>validateWorkspaceProject({...hidden.project,version:5}),{code:'PROJECT_CORRUPT'});
});
test('restoring a damaged hidden PNG fails without changing manifest or losing its trash record',t=>{
 const f=fixture(t),hidden=f.store.setImageDeleted(f.id,f.snapshot.revision,f.image.id,true);
 const file=path.join(f.folder,'images',f.image.sha256+'.png');fs.writeFileSync(file,'synthetic corrupt bytes');
 assert.throws(()=>f.store.setImageDeleted(f.id,hidden.revision,f.image.id,false),{code:'PROJECT_CORRUPT'});
 assert.deepEqual(f.store.readManifest(f.id),hidden);
 fs.writeFileSync(file,png());assert.deepEqual(f.store.setImageDeleted(f.id,hidden.revision,f.image.id,false).project.trashedImageIds,[]);
});
test('ordinary save, append, full copy and chosen history recovery preserve hidden records; input-only copy excludes results',t=>{
 const f=fixture(t), hidden=f.store.setImageDeleted(f.id,f.snapshot.revision,f.image.id,true);
 const saved=f.store.save(f.id,hidden.revision,{...f.content,name:'changed'});
 const appended=f.store.addPNG(f.id,saved.revision,f.input,png());
 assert.deepEqual(appended.project.trashedImageIds,[f.image.id]);assert.equal(appended.project.images.length,2);
 const copy=f.store.copy(f.id,appended.revision,f.content);assert.deepEqual(copy.project.trashedImageIds,[f.image.id]);assert.deepEqual(copy.project.images,appended.project.images);
 const recovered=f.store.recover(f.id,hidden.revision);assert.deepEqual(recovered.project.trashedImageIds,[f.image.id]);assert.notEqual(recovered.project.id,f.id);
 const input=f.store.create(f.content,f.id);assert.equal(input.project.images.length,0);assert.equal(input.project.trashedImageIds,undefined);
});
test('whole-project trash and restore preserve manifest bytes, PNG and every history file across a fresh store',t=>{
 const f=fixture(t),before=fs.readFileSync(path.join(f.folder,'project.json')), history=f.store.history(f.id);
 f.store.trashProject(f.id);assert.deepEqual(f.store.list(),[]);assert.equal(fs.existsSync(f.folder),false);
 assert.deepEqual(new ProjectStore(f.profile).listTrash(),[{id:f.id,name:f.content.name,revision:f.snapshot.revision}]);
 assert.deepEqual(fs.readFileSync(path.join(f.trash,'project.json')),before);
 assert.deepEqual(fs.readFileSync(path.join(f.trash,'images',f.image.sha256+'.png')),png());
 assert.throws(()=>f.store.generationSnapshot(f.id,f.snapshot.revision),{code:'PROJECT_NOT_FOUND'});
 f.store.restoreProject(f.id);assert.deepEqual(f.store.listTrash(),[]);assert.deepEqual(f.store.open(f.id),f.snapshot);assert.deepEqual(f.store.history(f.id),history);
});
test('existing write lock rejects trash; restore never overwrites an occupied project UUID',t=>{
 const f=fixture(t),lock=path.join(f.folder,'write.lock');fs.writeFileSync(lock,'synthetic active writer');
 assert.throws(()=>f.store.trashProject(f.id),{code:'PROJECT_BUSY'});assert.equal(fs.readFileSync(lock,'utf8'),'synthetic active writer');
 fs.unlinkSync(lock);f.store.trashProject(f.id);fs.mkdirSync(f.folder);fs.writeFileSync(path.join(f.folder,'sentinel'),'keep');
 assert.throws(()=>f.store.restoreProject(f.id),{code:'PROJECT_CONFLICT'});assert.equal(fs.readFileSync(path.join(f.folder,'sentinel'),'utf8'),'keep');assert.equal(fs.existsSync(f.trash),true);
});
test('damaged manifests can be moved/restored intact and a crash-left lock is preserved on restoration',t=>{
 const f=fixture(t);fs.writeFileSync(path.join(f.folder,'project.json'),'synthetic damaged json');f.store.trashProject(f.id);
 assert.equal(f.store.listTrash()[0].error,'PROJECT_CORRUPT');
 fs.writeFileSync(path.join(f.trash,'write.lock'),'synthetic crash after move');f.store.restoreProject(f.id);
 assert.equal(fs.readFileSync(path.join(f.folder,'project.json'),'utf8'),'synthetic damaged json');assert.equal(fs.readFileSync(path.join(f.folder,'write.lock'),'utf8'),'synthetic crash after move');
});
test('directory move failure leaves source intact and releases only its own lock',t=>{
 const f=fixture(t), before=fs.readFileSync(path.join(f.folder,'project.json'));const rename=fs.renameSync;
 const mock=t.mock.method(fs,'renameSync',(from,to)=>{if(from===f.folder)throw new Error('synthetic filesystem failure');return rename(from,to);});
 assert.throws(()=>f.store.trashProject(f.id),{code:'PROJECT_IO'});mock.mock.restore();
 assert.deepEqual(fs.readFileSync(path.join(f.folder,'project.json')),before);assert.equal(fs.existsSync(path.join(f.folder,'write.lock')),false);
});
test('trash root links and traversal IDs are rejected without touching a destination',t=>{
 const f=fixture(t);assert.throws(()=>f.store.trashProject('../outside'),{code:'PROJECT_INPUT'});assert.throws(()=>f.store.restoreProject('../outside'),{code:'PROJECT_INPUT'});
 if(process.platform==='win32'){t.diagnostic('symlink subcase requires Windows privileges; UUID/traversal assertions ran');return;}
 const outside=path.join(f.profile,'outside');fs.mkdirSync(outside);fs.symlinkSync(outside,path.dirname(f.trash));
 assert.throws(()=>f.store.trashProject(f.id),{code:'PROJECT_CORRUPT'});assert.deepEqual(fs.readdirSync(outside),[]);
});
test('real worker persists result visibility and moves/restores directories without a renderer file path',async t=>{
 const f=fixture(t),service=new ProjectService(f.profile,require.resolve('../main/projects/projectWorker.ts'));t.after(()=>service.close());
 const hidden=await service.setImageDeleted(f.id,f.snapshot.revision,f.image.id,true);await service.trashProject(f.id);assert.equal((await service.listTrash()).length,1);await service.restoreProject(f.id);assert.deepEqual(await service.open(f.id),hidden);
});
test('main mutation claims single flight before awaiting, rejects generation and expires earlier approval without sending',async t=>{
 const f=fixture(t);let sends=0;const service=new WorkspaceGeneration({store:f.store,offline:()=>false,sendImage:async()=>{sends++;return png();}});
 const plan=await service.prepare(f.id,f.snapshot.revision,f.content.selectedSceneId);let release;const gate=new Promise(r=>release=r);
 const mutation=service.withProjectMutation(async()=>{await gate;return f.store.setImageDeleted(f.id,f.snapshot.revision,f.image.id,true);});
 await assert.rejects(service.run(plan.ticket,true),{code:'GENERATION_BUSY'});await assert.rejects(service.prepare(f.id,f.snapshot.revision,f.content.selectedSceneId),{code:'GENERATION_BUSY'});assert.equal(service.hasWork(),true);release();await mutation;
 assert.equal(service.hasWork(),false);await assert.rejects(service.run(plan.ticket,true),{code:'CONFIRMATION_EXPIRED'});assert.equal(sends,0);
 await assert.rejects(service.withProjectMutation(async()=>{throw new Error('synthetic failure');}));assert.equal(service.hasWork(),false);
});
test('generation with an unsaved response rejects mutations, preserving pending PNG with zero additional send',async t=>{
 const f=fixture(t);let sends=0;const store=Object.create(f.store);store.addPNG=()=>{throw new Error('synthetic save failure');};
 const service=new WorkspaceGeneration({store,offline:()=>false,sendImage:async()=>{sends++;return png();}});
 const plan=await service.prepare(f.id,f.snapshot.revision,f.content.selectedSceneId);await assert.rejects(service.run(plan.ticket,true));assert.equal(service.status().pending,true);
 let mutations=0;await assert.rejects(service.withProjectMutation(async()=>mutations++),{code:'PROJECT_BUSY'});assert.equal(mutations,0);assert.equal(sends,1);assert.equal(service.status().pending,true);
});
test('trash IPC rejects untrusted frames, uses the mutation gate, and rechecks trust after awaiting',async t=>{
 const f=fixture(t),handlers=new Map();let trusted=false,gates=0;
 registerProjects({handle:(c,h)=>handlers.set(c,h)},f.store,()=>trusted,async(action)=>{gates++;return action();});
 assert.deepEqual(await handlers.get('workspace-project-trash')({},f.id),{ok:false,code:'PROJECT_UNTRUSTED'});assert.equal(gates,0);trusted=true;
 assert.equal((await handlers.get('workspace-project-image-deleted')({},f.id,f.snapshot.revision,f.image.id,true)).ok,true);assert.equal(gates,1);
 let release;const gate=new Promise(r=>release=r);const store={...f.store,list:async()=>{await gate;return [];}};
 const later=new Map();registerProjects({handle:(c,h)=>later.set(c,h)},store,()=>trusted);const reading=later.get('workspace-project-list')({});trusted=false;release();assert.deepEqual(await reading,{ok:false,code:'PROJECT_UNTRUSTED'});
});
test('reference source/derivative bytes survive result hiding, full copy and whole-project trash/restore',async t=>{
 const f=fixture(t),asset=await f.store.importReference(f.id,f.snapshot.revision,png());
 const content=structuredClone(f.content);content.scenes[0].draft.reference={...asset,role:'character',strength:1,preferSameOutfit:false};
 const saved=f.store.save(f.id,f.snapshot.revision,content);const hidden=f.store.setImageDeleted(f.id,saved.revision,f.image.id,true);
 const bytes=f.store.referenceImage(f.id,content.selectedSceneId);const copy=f.store.copy(f.id,hidden.revision,content);
 assert.deepEqual(f.store.referenceImage(copy.project.id,content.selectedSceneId),bytes);
 f.store.trashProject(f.id);f.store.restoreProject(f.id);assert.deepEqual(f.store.open(f.id),hidden);assert.deepEqual(f.store.referenceImage(f.id,content.selectedSceneId),bytes);
});
test('in-flight generation blocks trash and restore before their worker action can start',async t=>{
 const f=fixture(t);let release,started;const gate=new Promise(r=>release=r),ready=new Promise(r=>started=r);let mutations=0;
 const service=new WorkspaceGeneration({store:f.store,offline:()=>false,sendImage:async()=>{started();await gate;return png();}});
 const plan=await service.prepare(f.id,f.snapshot.revision,f.content.selectedSceneId);const sending=service.run(plan.ticket,true);await ready;
 await assert.rejects(service.withProjectMutation(async()=>mutations++),{code:'PROJECT_BUSY'});assert.equal(mutations,0);release();await sending;assert.equal(service.hasWork(),false);
});
test('trashing the reserved project drops stopped reservations and their approvals without sending',async t=>{
 const f=fixture(t);let sends=0;const service=new WorkspaceGeneration({store:f.store,offline:()=>false,sendImage:async()=>{sends++;return png();}});
 const plan=await service.prepareQueue(f.id,f.snapshot.revision,[f.content.selectedSceneId],2);
 await service.withProjectMutation(async()=>f.store.trashProject(f.id),f.id);
 assert.equal(service.queueStatus().queue,undefined);await assert.rejects(service.runQueue(plan.ticket,true),{code:'CONFIRMATION_EXPIRED'});assert.equal(sends,0);
});
test('post-rename sync failure reports uncertainty but leaves the moved project recoverable',t=>{
 const f=fixture(t),before=fs.readFileSync(path.join(f.folder,'project.json'));const sync=fs.fsyncSync;let fault=false;
 const mock=t.mock.method(fs,'fsyncSync',fd=>{if(!fault&&fs.existsSync(f.trash)&&fs.fstatSync(fd).isDirectory()){fault=true;throw Error('synthetic post-move sync failure');}return sync(fd);});
 if(process.platform==='win32'){mock.mock.restore();t.diagnostic('directory fsync intentionally skipped on Windows; exercised by Linux CI');return;}
 assert.throws(()=>f.store.trashProject(f.id),{code:'PROJECT_IO'});mock.mock.restore();assert.deepEqual(fs.readFileSync(path.join(f.trash,'project.json')),before);assert.equal(f.store.listTrash()[0].id,f.id);f.store.restoreProject(f.id);assert.deepEqual(f.store.open(f.id),f.snapshot);
});
