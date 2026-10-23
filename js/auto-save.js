const collections=['blogs','notes','timeline','messages'];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const clone=value=>structuredClone(value);
// Merge changes by record ID. Never silently overwrite edits to the same record.
export function mergeContent(base,local,remote){
  const merged={version:1};
  for(const key of collections){
    const before=new Map(base[key].map(r=>[r.id,r]));
    const ours=new Map(local[key].map(r=>[r.id,r]));
    const theirs=new Map(remote[key].map(r=>[r.id,r]));
    const rows=[];
    for(const id of new Set([...theirs.keys(),...ours.keys(),...before.keys()])){
      const b=before.get(id),l=ours.get(id),r=theirs.get(id);
      let chosen;
      if(same(l,b))chosen=r;
      else if(same(r,b)||same(l,r))chosen=l;
      else {const error=Error('同一条记录已被其他页面修改，自动保存已暂停；当前修改仍保留，请勿关闭页面。');error.conflict=true;throw error;}
      if(chosen)rows.push(clone(chosen));
    }
    merged[key]=rows;
  }
  return merged;
}
export class AutoSave {
  constructor(store,initial,{onState=()=>{},onSaved=()=>{},validate=v=>v,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){
    this.store=store;this.base=clone(initial);this.local=clone(initial);this.revision=0;this.savedRevision=0;
    this.onState=onState;this.onSaved=onSaved;this.validate=validate;this.wait=wait;this.running=null;
  }
  update(value){this.local=clone(value);this.revision++;return this.flush();}
  async commit(snapshot){
    for(let attempt=0;attempt<3;attempt++){
      try{
        const remote=this.validate(await this.store.read());
        const merged=mergeContent(this.base,snapshot,remote);
        await this.store.save(merged);return merged;
      }catch(error){
        if(attempt===2||!(error.status===409||error.retryable))throw error;
        if(error.status!==409)await this.wait(1000*(attempt+1));
      }
    }
  }
  flush(){
    if(this.running)return this.running;
    // Defer execution by a microtask so running is set before any callbacks.
    this.running=Promise.resolve().then(async()=>{
      try{
        while(this.savedRevision<this.revision){
          const version=this.revision,snapshot=clone(this.local);
          this.onState('saving');
          const committed=await this.commit(snapshot);
          // Include edits made while the request was in flight and remote additions.
          this.local=mergeContent(snapshot,this.local,committed);
          this.base=clone(committed);this.savedRevision=version;
          this.onSaved(clone(this.local),this.savedRevision===this.revision);
        }
        this.onState('saved');
      }catch(error){this.onState('error',error);}
      finally{this.running=null;}
    });
    return this.running;
  }
}
