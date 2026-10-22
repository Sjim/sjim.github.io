const encoder=new TextEncoder();
const base64=bytes=>btoa(String.fromCharCode(...bytes));
const bytes=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
async function key(password,salt){
  const material=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:210000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function encryptCredentials(token,password,repository){
  if(!token.trim()||!password)throw Error('请输入令牌和解密密码。');
  const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(password,salt),encoder.encode(token.trim()));
  return {enabled:true,repository,password,salt:base64(salt),iv:base64(iv),ciphertext:base64(new Uint8Array(ciphertext))};
}
export async function decryptCredentials(config){
  if(!config.enabled)return '';
  try{
    const value=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(config.iv)},await key(config.password,bytes(config.salt)),bytes(config.ciphertext));
    return new TextDecoder().decode(value);
  }catch{throw Error('自动连接配置解密失败，请重新生成 github-credentials.js。');}
}
export function credentialsSource(config){
  return '// Public password + ciphertext: visitors can recover this token.\nexport default '+JSON.stringify(config,null,2)+';\n';
}
