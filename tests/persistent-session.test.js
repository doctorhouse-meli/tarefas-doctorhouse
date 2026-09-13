import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import crypto from 'node:crypto';

test('sessão persistente não expira por tempo; assinatura e validade das sessões antigas continuam verificadas',()=>{
 let now=Date.now();class Clock extends Date { static now(){return now;} }
 const c=vm.createContext({crypto,Buffer,process:{env:{SESSION_SECRET:'session-test-key'}},Date:Clock});
 const source=fs.readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
 vm.runInContext(source.slice(source.indexOf('const TZ ='),source.lastIndexOf('if (process.argv[1]')).replaceAll('export ',''),c);
 const user={email:'person@test',perfil:'Colaborador',workspace:'Principal'};
 const token=c.signToken(user);
 now+=1000*60*60*24*365*10;
 assert.equal(c.verifyToken(token).email,user.email);
 assert.equal(c.verifyToken(token).persistent,true);
 const sign=claims=>{const payload=Buffer.from(JSON.stringify(claims)).toString('base64url');return payload+'.'+crypto.createHmac('sha256','session-test-key').update(payload).digest('base64url');};
 assert.equal(c.verifyToken(sign({...user,exp:now+1000})).email,user.email);
 assert.throws(()=>c.verifyToken(sign({...user,exp:now-1})),/expirada/);
 assert.throws(()=>c.verifyToken(sign(user)),/expirada/);
 const changed=Buffer.from(JSON.stringify({...user,perfil:'Admin',persistent:true})).toString('base64url')+'.'+token.split('.')[1];
 assert.throws(()=>c.verifyToken(changed),/invalida/);
});
