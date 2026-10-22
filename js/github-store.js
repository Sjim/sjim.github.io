// Tokens live only in this instance's memory, never in browser storage or URLs.
export const defaultRepository = Object.freeze({owner:'Sjim',repo:'sjim.github.io',branch:'master',path:'data/content.json'});
export function encodeContent(value) {
  const bytes=new TextEncoder().encode(JSON.stringify(value,null,2)+'\n');
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(binary);
}
export function decodeContent(content) {
  const binary=atob(content.replace(/\s/g,''));
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(binary,c=>c.charCodeAt(0))));
}
export class GitHubStore {
  #token;
  constructor(config,token='',request=globalThis.fetch) {
    for(const key of ['owner','repo'])if(!/^[a-zA-Z0-9_.-]+$/.test(config[key]||''))throw Error('仓库所有者或名称格式不正确。');
    if(!config.branch?.trim())throw Error('请填写保存分支。');
    this.config={...config,path:defaultRepository.path};this.#token=token;this.request=request;this.sha=null;this.loaded=false;
  }
  get writable(){return !!this.#token;}
  disconnect(){this.#token='';this.loaded=false;}
  async api(method,body) {
    const {owner,repo,branch,path}=this.config;
    const url=`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}${method==='GET'?`?ref=${encodeURIComponent(branch)}`:''}`;
    const headers={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
    if(body)headers['Content-Type']='application/json';
    if(this.#token)headers.Authorization=`Bearer ${this.#token}`;
    let response;
    try{response=await this.request(url,{method,headers,cache:'no-store',signal:AbortSignal.timeout(30000),...(body?{body:JSON.stringify(body)}:{})});}
    catch{throw Error('无法连接 GitHub，请检查网络后重试。');}
    if(!response.ok){
      const reasons={401:'令牌无效或已过期，请重新连接。',403:'GitHub 拒绝访问，请检查令牌权限、API 限流及分支保护规则。',404:'找不到仓库、分支或数据文件，请检查配置及令牌授权。',409:'远端文件已更新，已停止保存。请先导出备份，再重新载入远端内容并整理修改。',422:'GitHub 无法接受此次提交，请检查分支保护、文件大小或令牌权限。'};
      const error=Error(reasons[response.status]||`GitHub 请求失败（${response.status}），请稍后重试。`);error.status=response.status;throw error;
    }
    return response.json();
  }
  async read() {
    const file=await this.api('GET');
    if(file.type!=='file'||file.encoding!=='base64'||!file.content||!file.sha)throw Error('GitHub 文件无法读取；请将 JSON 控制在 1 MB 以内，并将照片作为独立图片文件上传。');
    const value=decodeContent(file.content);this.sha=file.sha;this.loaded=true;return value;
  }
  async save(value) {
    if(!this.writable||!this.loaded)throw Error('请先连接 GitHub 并载入远端数据。');
    const content=encodeContent(value);
    if(content.length>Math.floor(1024*1024*4/3))throw Error('数据文件超过 1 MB，请改用照片路径或链接，避免把大照片嵌入 JSON。');
    const result=await this.api('PUT',{message:'Update personal site content',branch:this.config.branch,sha:this.sha,content});
    if(!result.content?.sha)throw Error('GitHub 未返回文件版本，请重新连接确认保存结果。');
    this.sha=result.content.sha;return result;
  }
}
