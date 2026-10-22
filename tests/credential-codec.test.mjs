import test from 'node:test';
import assert from 'node:assert/strict';
import {encryptCredentials,decryptCredentials,credentialsSource} from '../js/credential-codec.js';
const repository={owner:'Sjim',repo:'sjim.github.io',branch:'master'};
test('generated source includes public password but only encrypted token; round-trip works',async()=>{
  const token='test-token-for-fixture',password='公开密码中文';
  const config=await encryptCredentials(token,password,repository);
  assert.equal(await decryptCredentials(config),token);
  const source=credentialsSource(config);assert.ok(source.includes(password));assert.ok(!source.includes(token));
  assert.deepEqual(config.repository,repository);
});
test('each encryption uses a new salt and IV',async()=>{
  const a=await encryptCredentials('fixture','password',repository),b=await encryptCredentials('fixture','password',repository);
  assert.notEqual(a.salt,b.salt);assert.notEqual(a.iv,b.iv);assert.notEqual(a.ciphertext,b.ciphertext);
});
test('wrong password fails; disabled config does not require credentials',async()=>{
  const config=await encryptCredentials('fixture','password',repository);
  await assert.rejects(decryptCredentials({...config,password:'wrong'}),/解密失败/);
  assert.equal(await decryptCredentials({enabled:false}),'');
});
