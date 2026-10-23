import test from 'node:test';
import assert from 'node:assert/strict';
import {AutoSave,mergeContent} from '../js/auto-save.js';
const empty=()=>({version:1,blogs:[],notes:[],timeline:[],messages:[]});
const row=(id,content)=>({id,title:id,content});
const tick=()=>new Promise(r=>setTimeout(r,0));
test('different records merge, deletions persist, same-record conflicts stop',()=>{
  const base=empty();base.notes=[row('a','old'),row('b','old')];
  const local=structuredClone(base);local.notes=[row('a','local')];
  const remote=structuredClone(base);remote.notes.push(row('c','remote'));
  assert.deepEqual(mergeContent(base,local,remote).notes,[row('a','local'),row('c','remote')]);
  remote.notes[0].content='other';assert.throws(()=>mergeContent(base,local,remote),/同一条记录/);
});
test('saving starts immediately and serializes rapid edits without overlap',async()=>{
  const initial=empty(),writes=[];let release,active=0,maxActive=0;
  const store={read:async()=>structuredClone(initial),save:async value=>{active++;maxActive=Math.max(active,maxActive);writes.push(structuredClone(value));if(writes.length===1)await new Promise(r=>release=r);Object.assign(initial,structuredClone(value));active--;}};
  const states=[];const saver=new AutoSave(store,initial,{onState:s=>states.push(s)});
  const first=empty();first.notes=[row('a','first')];const promise=saver.update(first);await tick();assert.equal(writes.length,1);
  const second=structuredClone(first);second.notes[0].content='second';saver.update(second);
  const third=structuredClone(second);third.notes.push(row('b','new'));saver.update(third);
  release();await promise;
  assert.equal(maxActive,1);assert.equal(writes.length,2);assert.deepEqual(writes[1],third);assert.equal(states.at(-1),'saved');
});
test('SHA conflict retries with remote additions without erasing them',async()=>{
  const initial=empty();let remote=empty(),attempts=0;
  const saver=new AutoSave({read:async()=>structuredClone(remote),save:async value=>{attempts++;if(attempts===1){remote.notes.push(row('remote','new'));const error=Error('conflict');error.status=409;throw error;}remote=structuredClone(value);}},initial);
  const local=empty();local.notes.push(row('local','new'));await saver.update(local);
  assert.equal(attempts,2);assert.deepEqual(remote.notes.map(r=>r.id).sort(),['local','remote']);
});
test('network errors retry automatically then keep edits pending for later retry',async()=>{
  const initial=empty();let attempts=0,fail=true;const states=[];
  const saver=new AutoSave({read:async()=>structuredClone(initial),save:async value=>{attempts++;if(fail){const error=Error('network');error.retryable=true;throw error;}Object.assign(initial,structuredClone(value));}},initial,{wait:async()=>{},onState:s=>states.push(s)});
  const local=empty();local.notes.push(row('a','pending'));await saver.update(local);
  assert.equal(attempts,3);assert.equal(states.at(-1),'error');assert.ok(saver.savedRevision<saver.revision);
  fail=false;await saver.flush();assert.equal(initial.notes[0].content,'pending');assert.equal(states.at(-1),'saved');
});
test('same-record conflict never writes over remote even when retrying',async()=>{
  const initial=empty();initial.notes=[row('a','old')];const remote=structuredClone(initial);remote.notes[0].content='other';let writes=0;
  const saver=new AutoSave({read:async()=>structuredClone(remote),save:async()=>writes++},initial);
  const local=structuredClone(initial);local.notes[0].content='local';await saver.update(local);await saver.flush();assert.equal(writes,0);assert.ok(saver.savedRevision<saver.revision);
});
