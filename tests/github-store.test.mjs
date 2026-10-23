import test from 'node:test';
import assert from 'node:assert/strict';
import {GitHubStore,defaultRepository,encodeContent,decodeContent} from '../js/github-store.js';
const value={version:1,blogs:[{id:'blog-1',title:'中文 🎸',content:'日记\n第一行'}],notes:[],timeline:[],messages:[]};
const response=(body,status=200)=>new Response(JSON.stringify(body),{status});
test('UTF-8 content round-trips Chinese, emoji and large character sequences',()=>{
  assert.deepEqual(decodeContent(encodeContent(value)),value);
  const large={text:'一年🎹'.repeat(40000)};assert.deepEqual(decodeContent(encodeContent(large)),large);
});
test('authenticated read and PUT use selected branch and latest SHA without token in URL or body',async()=>{
  const calls=[];
  const request=async(url,options)=>{calls.push({url,options});return options.method==='GET'?response({type:'file',encoding:'base64',content:encodeContent(value),sha:'initial-sha'}):response({content:{sha:'next-sha'}});};
  const store=new GitHubStore({...defaultRepository,branch:'feature/content'},'test-token',request);
  assert.deepEqual(await store.read(),value);await store.save(value);await store.save(value);
  assert.ok(calls[0].url.endsWith('?ref=feature%2Fcontent'));
  assert.equal(calls[0].options.headers.Authorization,'Bearer test-token');
  assert.equal(JSON.parse(calls[1].options.body).sha,'initial-sha');
  assert.equal(JSON.parse(calls[2].options.body).sha,'next-sha');
  assert.deepEqual(decodeContent(JSON.parse(calls[1].options.body).content),value);
  assert.ok(calls.every(c=>!c.url.includes('test-token')&&!String(c.options.body).includes('test-token')));
  store.disconnect();await assert.rejects(store.save(value),/先连接/);
});
test('SHA conflict stops write and retains expected version instead of fetching and overwriting',async()=>{
  const calls=[];
  const store=new GitHubStore(defaultRepository,'test-token',async(url,options)=>{calls.push(options.method);return options.method==='GET'?response({type:'file',encoding:'base64',content:encodeContent(value),sha:'old'}):response({},409);});
  await store.read();await assert.rejects(store.save(value),/远端文件已更新/);
  assert.equal(store.sha,'old');assert.deepEqual(calls,['GET','PUT']);
});
test('read-only requests omit authorization and cannot commit',async()=>{
  const store=new GitHubStore(defaultRepository,'',async(url,options)=>{assert.equal(options.headers.Authorization,undefined);return response({type:'file',encoding:'base64',content:encodeContent(value),sha:'old'});});
  await store.read();await assert.rejects(store.save(value),/先连接/);
});
test('auth, permission, missing-file errors do not reveal response bodies',async()=>{
  for(const status of [401,403,404,422]){
    const store=new GitHubStore(defaultRepository,'test-token',async()=>response({message:'secret-response'},status));
    await assert.rejects(store.read(),e=>e.status===status&&!e.message.includes('secret-response'));
  }
});
test('unsupported large-file response and oversize writes fail before committing',async()=>{
  let puts=0;
  const store=new GitHubStore(defaultRepository,'test-token',async(url,options)=>{if(options.method==='PUT')puts++;return response({type:'file',encoding:'base64',content:encodeContent(value),sha:'old'});});
  await store.read();await assert.rejects(store.save({text:'x'.repeat(1024*1024+1)}),/超过 1 MB/);assert.equal(puts,0);
  const unsupported=new GitHubStore(defaultRepository,'test-token',async()=>response({type:'file',encoding:'none',content:'',sha:'old'}));
  await assert.rejects(unsupported.read(),/1 MB/);
});
test('request functions receive the browser global as receiver',async()=>{
  const store=new GitHubStore(defaultRepository,'',async function(){
    assert.equal(this,globalThis);
    return response({type:'file',encoding:'base64',content:encodeContent(value),sha:'browser-sha'});
  });
  assert.deepEqual(await store.read(),value);
});
