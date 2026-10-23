import { AutoSave } from './auto-save.js';
import savedCredentials from './github-credentials.js';
import { decryptCredentials } from './credential-codec.js';
import { GitHubStore, defaultRepository } from './github-store.js';
const $ = (s) => document.querySelector(s);
const escape = (s = '') => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const blank = () => ({version:1,blogs:[],notes:[],timeline:[],messages:[]});
let data = blank(), scores = [], dirty = false, active = 'blog', query = '', editing;
let github, autosave, loadedBase, revision = 0, connectionError = '';
let name = '';
try { name = localStorage.getItem('lsn-name') || ''; } catch {}
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('lsn-chat') : null;
const titles = {blog:['WORDS & THOUGHTS','把想法，留在这里。','关于生活、音乐，和偶尔冒出来的灵感。','写一篇博客'],scores:['MUSIC COLLECTION','日常有旋律。','收藏喜欢的琴谱，在指尖重温熟悉的旋律。'],notes:['DAILY NOTES','记下，才不会忘。','待办、灵感、琐事。给每天留一点记录。','新建备忘录'],chat:['A LITTLE CONVERSATION','来聊一会儿。','一个名字，一句话，开启一段对话。'],anniversary:['OUR FIRST YEAR','一年，很多个瞬间。','用照片和文字，把一起走过的时光串起来。','添加回忆']};
const keyFor = {blog:'blogs',notes:'notes',anniversary:'timeline'};
const id = () => crypto.randomUUID();
function toast(text) { $('#toast').textContent=text; $('#toast').classList.add('visible'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>$('#toast').classList.remove('visible'),3000); }
function photoURL(path) {
  if (typeof path !== 'string') return '';
  if (/^data:image\/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(path)) return path;
  try { const u=new URL(path,location.href); if(['http:','https:'].includes(u.protocol)) return u.href; } catch {}
  return '';
}
function validate(value) {
  if (!value || value.version !== 1 || !['blogs','notes','timeline','messages'].every(k=>Array.isArray(value[k]))) throw Error('仓库 JSON 数据格式不正确。');
  const ids=new Set();
  for(const k of ['blogs','notes','timeline','messages']) for(const row of value[k]) {
    if(!row || typeof row.id!=='string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(row.id) || ids.has(row.id)) throw Error('记录 ID 缺失或重复。'); ids.add(row.id);
    if(typeof row.content!=='string' || row.content.length>20000) throw Error('记录正文无效或超过 20000 字。');
    if(k==='messages') { if(typeof row.name!=='string' || !row.name.trim() || row.name.length>24 || !Number.isFinite(Date.parse(row.created))) throw Error('消息格式无效。'); }
    else if(typeof row.title!=='string' || !row.title.trim() || row.title.length>100) throw Error('标题无效。');
    if(k==='timeline' && (!/^\d{4}-(0[1-9]|1[0-2])$/.test(row.month) || !Array.isArray(row.photos) || row.photos.some(p=>!photoURL(p)))) throw Error('回忆日期或照片格式无效。');
  }
  return value;
}
function syncState(state,error){
  const status=$('#sync-status');
  status.textContent=state==='saving'?'正在保存…':state==='saved'?'已自动保存':error?.message||'自动连接未完成';
  status.dataset.state=state;
  $('#sync-retry').hidden=state!=='error';
  $('#sync-retry').disabled=!loadedBase;
  if(state==='error')toast('自动保存失败，修改已保留，请勿关闭页面');
}
async function persist(){
  dirty=true;revision++;
  if(!autosave){syncState('error',Error(connectionError||'尚未连接 GitHub，请重试'));return;}
  await autosave.update(data);
}
function prepareAutoSave(initial=data){
  autosave=new AutoSave(github,initial,{validate,onState:syncState,onSaved:(latest,clean)=>{
    const changed=JSON.stringify(latest)!==JSON.stringify(data);
    data=latest;dirty=!clean;
    if(changed){if(active==='chat')renderMessages();else if($('#list'))renderList();}
  }});
  if(!dirty)syncState('saved');
}
function empty(title, description, symbol='＋') { return `<div class="empty"><span class="symbol">${symbol}</span><h2>${title}</h2><p>${description}</p></div>`; }
function render() {
  const [label,title,desc,add]=titles[active];
  document.querySelectorAll('[data-tab]').forEach(b=>{b.setAttribute('aria-selected',String(b.dataset.tab===active));b.tabIndex=b.dataset.tab===active?0:-1;b.id=`tab-${b.dataset.tab}`;b.setAttribute('aria-controls','page');});
  $('#page').setAttribute('aria-labelledby',`tab-${active}`);
  $('#page').innerHTML=`<div class="page-head"><div><p class="eyebrow">${label}</p><h1>${title}</h1><p class="intro">${desc}</p></div>${add?`<button class="primary" data-add>＋ ${add}</button>`:''}</div><div id="content"></div>`;
  if(active==='chat') {renderChat();return;}
  const rows=active==='scores'?scores:data[keyFor[active]];
  $('#content').innerHTML=`<div class="toolbar"><input id="search" type="search" aria-label="搜索" placeholder="${active==='scores'?'搜索琴谱名称…':'搜索标题或正文…'}" value="${escape(query)}"><span class="count">${rows.length} ${active==='scores'?'首琴谱':active==='anniversary'?'段回忆':'条记录'}</span></div><div id="list"></div>`;
  $('#search').addEventListener('input',e=>{query=e.target.value;renderList();}); renderList();
}
function renderList() {
  const rows=(active==='scores'?scores:data[keyFor[active]]).filter(r=>(r.title+' '+(r.content||'')).toLowerCase().includes(query.toLowerCase()));
  if(!rows.length) {$('#list').innerHTML=empty(query?'没有找到匹配的内容':active==='anniversary'?'故事，从第一张照片开始':active==='scores'?'暂无琴谱':'这里还留着空白',query?'换个关键词试试。':'点击右上角按钮，写下第一条记录。');return;}
  if(active==='scores') {$('#list').className='grid';$('#list').innerHTML=rows.map(r=>`<a class="card score" href="#scores/${scores.indexOf(r)}"><img loading="lazy" src="${escape(r.img)}" alt="${escape(r.title)}琴谱预览"><div class="score-info"><h2>${escape(r.title)}</h2><p class="meta">${r.imgs.length} 页琴谱 <span style="float:right">↗</span></p></div></a>`).join('');return;}
  $('#list').className=active==='anniversary'?'timeline':active==='notes'?'grid':'';
  $('#list').innerHTML=[...rows].sort((a,b)=>active==='anniversary'?a.month.localeCompare(b.month):String(b.updated).localeCompare(String(a.updated))).map(r=>`<article class="card ${active==='anniversary'?'moment':''}" ${active==='blog'?'style="margin-bottom:18px"':''}>${active==='anniversary'?`<time>${escape(r.month.replace('-',' / '))}</time>`:`<p class="meta">${escape(r.updated?.slice(0,10)||'')} ${active==='notes'&&r.done?'· 已完成':''}</p>`}<h2>${escape(r.title)}</h2><p class="entry-body">${escape(r.content)}</p>${active==='anniversary'?`<div class="photos">${r.photos.map(p=>`<a href="${escape(photoURL(p))}" target="_blank" rel="noopener"><img loading="lazy" src="${escape(photoURL(p))}" alt="${escape(r.title)}"></a>`).join('')}</div>`:''}<div class="actions">${active==='notes'?`<button data-toggle="${r.id}">${r.done?'标为未完成':'标为完成'}</button>`:''}<button data-edit="${r.id}">编辑</button><button data-delete="${r.id}">删除</button></div></article>`).join('');
}
function openEditor(row) {
  editing={key:keyFor[active],row};
  $('#editor-title').textContent=row?'编辑记录':titles[active][3];
  $('#editor-fields').innerHTML=`<label>标题<input name="title" required maxlength="100" value="${escape(row?.title||'')}"></label>${active==='anniversary'?`<label>时间（年月）<input name="month" type="month" required value="${escape(row?.month||new Date().toISOString().slice(0,7))}"></label>`:''}<label>正文<textarea name="content" required maxlength="20000">${escape(row?.content||'')}</textarea></label>${active==='anniversary'?`<label>照片地址（每行一张，可使用项目内路径或 HTTPS 地址）<textarea name="photos" placeholder="photo/anniversary/first.jpg">${escape((row?.photos||[]).filter(p=>!p.startsWith('data:')).join('\n'))}</textarea></label><label>或上传照片（保存进 JSON，单张不超过 5 MB）<input name="uploads" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple></label><p class="muted">已有上传照片会保留。<label><input name="clearPhotos" type="checkbox" style="width:auto"> 移除已有上传照片</label></p>`:''}`;
  $('#editor-error').textContent='';$('#editor').showModal();
}
function promptName() {
  editing={name:true};$('#editor-title').textContent='先认识一下你';$('#editor-fields').innerHTML=`<p class="intro">选一个名字，它会显示在你的消息旁。</p><label>你的名字<input name="name" required maxlength="24" autocomplete="nickname" value="${escape(name)}"></label>`;$('#editor-error').textContent='';$('#editor').showModal();
}
function renderChat() {
  $('#content').innerHTML=`<div class="chat-box"><div class="chat-info"><span>${name?escape(name):'还未设置名字'} · 本地对话</span><button id="rename">${name?'修改名字':'设置名字'}</button></div><div class="messages" id="messages" aria-live="polite" aria-label="对话消息"></div><form class="composer" id="composer"><textarea name="message" aria-label="消息" placeholder="写下想说的话…" required maxlength="2000"></textarea><button class="primary">发送 ↗</button></form></div><p class="notice">当前为纯前端模式：消息仅在同一浏览器、同一站点的标签页间实时同步，无法跨设备公共聊天。消息历史随 JSON 文件保存。</p>`;
  renderMessages();$('#rename').onclick=promptName;
  $('#composer').onsubmit=async e=>{e.preventDefault();if(!name){promptName();return;}const input=e.target.elements.message,content=input.value.trim();if(!content)return; const msg={id:id(),name,content,created:new Date().toISOString()};data.messages.push(msg);channel?.postMessage(msg);input.value='';renderMessages();await persist();};
  if(!name)promptName();
}
function renderMessages() {
  if(!$('#messages'))return;
  $('#messages').innerHTML=data.messages.length?[...data.messages].sort((a,b)=>a.created.localeCompare(b.created)).map(m=>`<div class="message ${m.name===name?'mine':''}"><p class="meta">${escape(m.name)} · ${escape(new Date(m.created).toLocaleString('zh-CN'))}</p><div class="message-body">${escape(m.content)}</div></div>`).join(''):empty('还没有消息','写一句话，开启这里的对话。','〰');
  $('#messages').scrollTop=$('#messages').scrollHeight;
}
channel?.addEventListener('message',async e=>{try{const test=blank();test.messages=[e.data];validate(test);if(data.messages.some(m=>m.id===e.data.id))return;data.messages.push(e.data);renderMessages();}catch{}});
$('#editor-form').onsubmit=async e=>{
  e.preventDefault();const form=e.target.elements;const save=e.submitter || e.target.querySelector('button[type="submit"]');save.disabled=true;
  try {
    if(editing.name){const next=form.name.value.trim();if(!next)throw Error('请输入名字');name=next;try{localStorage.setItem('lsn-name',name);}catch{}$('#editor').close();renderChat();return;}
    const title=form.title.value.trim(),content=form.content.value.trim();if(!title||!content)throw Error('标题和正文不能为空。');
    const row={...editing.row,id:editing.row?.id||id(),title,content,updated:new Date().toISOString()};
    if(editing.key==='timeline') {
      row.month=form.month.value;
      row.photos=form.photos.value.split('\n').map(s=>s.trim()).filter(Boolean);
      if(row.photos.some(p=>!photoURL(p)))throw Error('照片地址须为项目路径或 HTTP/HTTPS 图片链接。');
      if(!form.clearPhotos.checked)row.photos.push(...(editing.row?.photos||[]).filter(p=>p.startsWith('data:')));
      for(const file of form.uploads.files){if(file.size>5*1024*1024||!/^image\/(png|jpeg|webp|gif)$/.test(file.type))throw Error('请选择不超过 5 MB 的 PNG、JPEG、WebP 或 GIF 图片。');row.photos.push(await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);}));}
      if(!row.photos.length)throw Error('请至少添加一张照片。');
    }
    const list=data[editing.key],index=list.findIndex(r=>r.id===row.id);if(index<0)list.push(row);else list[index]=row;
    $('#editor').close();render();await persist();
  }catch(err){$('#editor-error').textContent=err.message||'保存失败，请重试。';}finally{save.disabled=false;}
};
$('#page').addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b)return;
  const list=data[keyFor[active]];
  if(b.hasAttribute('data-add'))openEditor();
  if(b.dataset.edit)openEditor(list.find(r=>r.id===b.dataset.edit));
  if(b.dataset.delete&&confirm('确定删除这条记录吗？')){data[keyFor[active]]=list.filter(r=>r.id!==b.dataset.delete);render();await persist();}
  if(b.dataset.toggle){const row=list.find(r=>r.id===b.dataset.toggle);row.done=!row.done;row.updated=new Date().toISOString();render();await persist();}
});
for(const b of document.querySelectorAll('[data-tab]'))b.onclick=()=>location.hash=b.dataset.tab;
$('nav').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tabs=[...document.querySelectorAll('[data-tab]')];let i=tabs.indexOf(document.activeElement);i=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[i].focus();tabs[i].click();});
for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>b.closest('dialog').close();
async function route(){const [tab,index]=location.hash.slice(1).split('/');active=tab in titles?tab:'blog';query='';render();if(active==='scores'&&index!==undefined){const score=scores[Number(index)];if(!score){toast('琴谱不存在');return;}$('#content').innerHTML=`<a class="back" href="#scores">← 返回琴谱列表</a><h2 style="margin-top:24px">${escape(score.title)}</h2><p class="meta">共 ${score.imgs.length} 页 · 点击图片查看原图</p><div class="score-pages">${score.imgs.map(p=>`<a href="${escape(p)}" target="_blank" rel="noopener"><img src="${escape(p)}" alt="${escape(score.title)}" loading="lazy"></a>`).join('')}</div>`;}}
window.addEventListener('hashchange',route);
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
async function readInitialContent(){
  if(savedCredentials.enabled){
    let candidate;
    try{
      const token=await decryptCredentials(savedCredentials);
      if(!token.trim())throw Error('自动连接令牌为空，请检查 github-credentials.js。');
      candidate=new GitHubStore(savedCredentials.repository,token);
      data=validate(await candidate.read());github=candidate;connectionError='';prepareAutoSave();return;
    }catch(err){candidate?.disconnect();connectionError=err.message;syncState('error',err);}
  }else{connectionError='自动连接未启用，请检查 github-credentials.js。';syncState('error',Error(connectionError));}
  try{data=validate(await new GitHubStore(savedCredentials.enabled?savedCredentials.repository:defaultRepository).read());}
  catch{try{const response=await fetch('data/content.json');if(!response.ok)throw Error();data=validate(await response.json());}catch{toast('数据文件读取失败，请检查 data/content.json');}}
}
let retrying=false;
$('#sync-retry').onclick=async()=>{
  if(retrying||!loadedBase)return;retrying=true;$('#sync-retry').disabled=true;
  try{
    if(autosave){await autosave.flush();return;}
    syncState('saving');
    const token=await decryptCredentials(savedCredentials);
    if(!token.trim())throw Error('自动连接未配置可用令牌。');
    const candidate=new GitHubStore(savedCredentials.repository,token);
    // Use the last loaded data as base; preserve edits made offline.
    const initial=structuredClone(loadedBase);
    const remote=validate(await candidate.read());github=candidate;
    if(dirty){prepareAutoSave(initial);await autosave.update(data);}
    else{data=remote;prepareAutoSave();render();}
  }catch(err){connectionError=err.message;syncState('error',err);}
  finally{retrying=false;$('#sync-retry').disabled=false;}
};
await Promise.all([readInitialContent(),fetch('tableData.json').then(r=>{if(!r.ok)throw Error();return r.json();}).then(v=>scores=v).catch(()=>toast('琴谱目录读取失败'))]);
loadedBase=structuredClone(data);
$('#sync-retry').disabled=false;
route();
