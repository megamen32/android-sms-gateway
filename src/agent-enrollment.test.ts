import { test, expect } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { AgentQueue, enrollmentScope } from './agent-queue';

test('device token rotation preserves tenant alias and durable ingress without storing raw tokens', () => {
  mkdirSync('.tmp/agent-tests', { recursive: true });
  const path = `.tmp/agent-tests/enroll-${crypto.randomUUID()}.sqlite`;
  let queue = new AgentQueue(path);
  const a = enrollmentScope('user-a', 'android-00112233', `sms:user-${createHash('sha256').update('user-a').digest('hex').slice(0,16)}-android-00112233`);
  const b = enrollmentScope('user-b', a.device_id, `sms:user-${createHash('sha256').update('user-b').digest('hex').slice(0,16)}-${a.device_id}`);
  const first = queue.enroll(a), second = queue.enroll(b), rotated = queue.enroll(a);
  expect(queue.authenticate(first.device_token)).toBeNull();
  expect(queue.authenticate(rotated.device_token)).toEqual(a);
  expect(queue.authenticate(second.device_token)).toEqual(b);
  expect(readFileSync(path).includes(Buffer.from(rotated.device_token))).toBe(false);
  queue.rememberInbound({ id:'fixture-inbound',device_id:a.gateway_device_id,account_id:a.account_id,user_id:a.user_id,sender:'900',body:'fixture',received:1 });
  queue.close(); queue = new AgentQueue(path);
  expect(queue.authenticate(rotated.device_token)).toEqual(a);
  expect(queue.nextInbound()?.id).toBe('fixture-inbound');
  queue.completeInbound('fixture-inbound',true);
  expect(queue.nextInbound()).toBeNull();queue.close();
});

test('two users enroll existing APK fields and cannot claim or report each other; callbacks use exact registered account', async () => {
  const physical = 'android-00112233';
  const scope = (user:string) => ({ user_id:user,device_id:physical,account_id:`sms:user-${createHash('sha256').update(user).digest('hex').slice(0,16)}-${physical}` });
  const a=scope('user-a'),b=scope('user-b');
  const messages:any[]=[],attempts:any[]=[];let ownerRegistrations=0,disabled=false,failOnce=true,bindingUnavailable=false;
  const mock = Bun.serve({ hostname:'127.0.0.1',port:0,fetch:async request=>{
    if(request.headers.get('authorization')!=='Bearer fixture-ingress') return Response.json({}, {status:401});
    const url=new URL(request.url);
    if(url.pathname==='/v1/sms/agent-binding') {
      if(bindingUnavailable) return Response.json({error:'fixture binding outage'},{status:503});
      const user=url.searchParams.get('user_id'),account=url.searchParams.get('account_id');
      const registered=[a,b].some(binding=>binding.user_id===user&&binding.account_id===account)&&!(disabled&&user===a.user_id);
      return Response.json({registered,can_read:registered,can_reply:registered});
    }
    if(url.pathname==='/v1/accounts'){ownerRegistrations++;return Response.json({}, {status:202});}
    if(url.pathname==='/v1/messages'){
      const payload=await request.json();attempts.push(payload);
      if(failOnce){failOnce=false;return Response.json({error:'fixture temporary outage'},{status:503});}
      messages.push(payload);return Response.json({accepted:true},{status:202});
    }
    return Response.json({}, {status:404});
  }});
  mkdirSync('.tmp/agent-tests',{recursive:true});
  const reserve=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>new Response('fixture')});
  const suffix=crypto.randomUUID(),port=reserve.port;await reserve.stop(true);
  const child=Bun.spawn([process.execPath,Bun.env.TEST_GATEWAY_SOURCE||'src/server.ts'],{env:{
    ...Bun.env,PORT:String(port),HOST:'127.0.0.1',SMS_GATEWAY_API_KEY:'fixture-api',SMS_GATEWAY_DEVICE_TOKEN:'fixture-legacy',ANDROID_SERIAL:'fixture-native',
    SMS_SSH_HOST:'',SMS_QUEUE_PATH:`.tmp/agent-tests/enroll-native-${suffix}.sqlite`,SMS_AGENT_QUEUE_PATH:`.tmp/agent-tests/enroll-agents-${suffix}.sqlite`,
    UNIVERSAL_USERIO_URL:mock.url.toString(),USERIO_API_TOKEN:'fixture-ingress',
  },stdout:'pipe',stderr:'pipe'});
  const request=async(path:string,body?:object,token='fixture-api')=>{
    const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    const raw=await r.text();
    if(raw==='null') throw new Error(`unexpected null response: ${r.status} ${path} server=${r.headers.get('server')}`);
    return {status:r.status,body:JSON.parse(raw) as any};
  };
  try {
    for(let i=0;i<40;i++){try{await request('/v1/agent');break;}catch{await Bun.sleep(25);}}
    const enrollmentA=await request('/v1/agent/enroll',a);expect(enrollmentA.body.error).toBeUndefined();expect(enrollmentA.status).toBe(201);
    const enrollmentB=await request('/v1/agent/enroll',b);expect(enrollmentB.status).toBe(201);
    const tokenA=enrollmentA.body.device_token,tokenB=enrollmentB.body.device_token;
    for(const token of [tokenA,tokenB]) expect((await request('/agent/hello',{device_id:physical,model:'fixture'},token)).body.account_registered).toBe(true);
    expect(ownerRegistrations).toBe(0);
    expect((await request('/agent/hello',{device_id:'another-physical'},tokenA)).status).toBe(400);
    const aliasA=enrollmentA.body.gateway_device_id,aliasB=enrollmentB.body.gateway_device_id;
    const workA=await request('/v1/agent/ping',{device_id:aliasA});
    const workB=await request('/v1/messages',{device_id:aliasB,to:'+15550000001',body:'fixture never executed on a phone'});
    expect(workA.status).toBe(202);expect(workB.status).toBe(202);
    expect((await request('/agent/tasks?device_id='+aliasB,undefined,tokenA)).status).toBe(400);
    expect((await request('/agent/tasks?device_id='+aliasB,undefined,'fixture-legacy')).status).toBe(400);
    expect((await request('/agent/tasks?device_id='+physical,undefined,tokenA)).body.tasks.map((task:any)=>task.id)).toEqual([workA.body.id]);
    expect((await request('/agent/tasks?device_id='+physical,undefined,tokenB)).body.tasks.map((task:any)=>task.id)).toEqual([workB.body.id]);
    expect((await request('/agent/results',{device_id:physical,task_id:workA.body.id,status:'ok'},tokenB)).status).toBe(409);
    expect((await request('/agent/results',{device_id:physical,task_id:workA.body.id,status:'ok'},tokenA)).status).toBe(200);
    for(const token of [tokenA,tokenB]) expect((await request('/agent/inbound',{device_id:physical,from:'SBER',body:'fixture inbound',received_at:1000},token)).status).toBe(200);
    for(let i=0;i<880&&messages.length<2;i++) await Bun.sleep(25);
    expect(messages.map(m=>m.account_id).sort()).toEqual([a.account_id,b.account_id].sort());
    expect(new Set(messages.map(m=>m.message.message_id)).size).toBe(2);
    expect(attempts.length).toBe(3);
    expect(attempts[0].message.message_id).toBe(attempts[2].message.message_id);
    expect(attempts[0].account_id).toBe(attempts[2].account_id);
    expect(messages.every(m=>m.route_id==='sms'&&m.message.sender==='SBER'&&m.message.source==='sms')).toBe(true);
    disabled=true;
    expect((await request('/agent/tasks?device_id='+physical,undefined,tokenA)).status).toBe(403);
    expect((await request('/agent/inbound',{device_id:physical,from:'900',body:'disabled fixture'},tokenA)).status).toBe(403);
    expect((await request('/agent/hello',{device_id:physical},tokenA)).body.account_registered).toBe(false);
    expect((await request('/v1/agent/enroll',a)).status).toBe(403);
    expect((await request('/agent/tasks?device_id='+physical,undefined,tokenB)).status).toBe(200);
    bindingUnavailable=true;
    expect((await request('/agent/tasks?device_id='+physical,undefined,tokenB)).status).toBe(503);
    expect((await request('/agent/hello',{device_id:physical},tokenB)).body.account_registered).toBe(false);
    expect(ownerRegistrations).toBe(0);
  }finally{child.kill();await child.exited;await mock.stop(true);const errors=await new Response(child.stderr).text();if(errors) console.error(errors);}
},25_000);
