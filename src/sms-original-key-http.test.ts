import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';

const sha=(s:string)=>createHash('sha256').update(s).digest('hex');

test('GET original send status looks up exact key without creating another SMS task',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'sms-original-api-'));
 const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>new Response('fixture')});
 const port=server.port;await server.stop(true);
 const child=Bun.spawn([process.execPath,'src/server.ts'],{cwd:process.cwd(),env:{
   ...Bun.env,HOST:'127.0.0.1',PORT:String(port),
   SMS_GATEWAY_API_KEY:'synthetic-api',SMS_GATEWAY_DEVICE_TOKEN:'synthetic-device',
   ANDROID_SERIAL:'synthetic-serial',SMS_SSH_HOST:'',SMS_SSH_HELPER:'',
   SMS_AGENT_QUEUE_PATH:join(dir,'agents.sqlite'),SMS_QUEUE_PATH:join(dir,'native.sqlite'),
   UNIVERSAL_USERIO_URL:'',USERIO_API_TOKEN:'',SMS_AGENT_APK_PATH:'/missing'
 },stdout:'ignore',stderr:'ignore'});
 const host='http://127.0.0.1:'+port;
 const key='draft-original-only-123',recipient='+15550000001',body='synthetic-not-sent';
 const request=async(path:string, method='GET', payload?:unknown, idem=key,authorized=true)=>{
  const res=await fetch(host+path,{method,headers:{
   ...(authorized?{Authorization:'Bearer synthetic-api'}:{}),
   ...(idem?{'Idempotency-Key':idem}:{}),
   'Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined,
   signal:AbortSignal.timeout(2000)});
  return {code:res.status,payload:await res.json() as any};
 };
 try{
  let ready=false;
  for(let i=0;i<100;i++){
   try{
    const p=await request('/v1/agent');if(p.code===200){ready=true;break;}
   }catch{}
   await Bun.sleep(25);
  }
  expect(ready).toBe(true);
  const hello=await fetch(host+'/agent/hello',{method:'POST',
     headers:{Authorization:'Bearer synthetic-device','Content-Type':'application/json'},
     body:JSON.stringify({device_id:'phone-test',model:'fixture'})});
  expect(hello.status).toBe(200);
  const accepted=await request('/v1/messages','POST',
    {to:recipient,body,device_id:'phone-test'});
  expect(accepted.code).toBe(202);
  const q='/v1/original-send?'+new URLSearchParams({
   recipient_sha256:sha(recipient),body_sha256:sha(body),device_id:'phone-test'});
  const found=await request(q);
  expect(found.code).toBe(200);
  expect(found.payload.id).toBe(accepted.payload.id);
  expect(found.payload.status).toBe('queued_for_device');
  expect(found.payload.evidence).toBeNull();
  expect(found.payload.recipient_delivery_confirmed).toBe(false);
  expect((await request(q,'GET',undefined,'other-key')).code).toBe(404);
  expect((await request(q.replace('phone-test','phone-foreign'))).code).toBe(404);
  expect((await request(q.replace(sha(body),sha('different')))).code).toBe(404);
  expect((await request(q,'GET',undefined,key,false)).code).toBe(401);
  // Still only the original task in the queue.
  const agent=await request('/v1/agent');
  expect(agent.payload.queue.filter((x:any)=>x.id===accepted.payload.id).length).toBe(1);
 }finally{
  child.kill();await child.exited;
  rmSync(dir,{recursive:true,force:true});
 }
},12_000);
