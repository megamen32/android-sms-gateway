import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {AgentQueue} from './agent-queue';
import {SmsQueue} from './termux-queue';

const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const recipient='+15550000001', body='offline fixture only', key='draft-original-key';
const fakeTransport={ready:async()=>false,send:async()=>{throw Error('provider send forbidden');}};

test('APK originally queued key has exact scoped read-only lookup',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sms-original-apk-'));
 try{
  const queue=new AgentQueue(join(dir,'agent.sqlite'));
  queue.rememberDevice({id:'phone-a'});
  const task=queue.enqueue('phone-a','send_sms',recipient,body,key);
  const proof=queue.originalByKey(key,'phone-a',sha(recipient),sha(body));
  expect(proof?.id).toBe(task.id);
  expect(proof?.status).toBe('queued_for_device');
  expect(queue.originalByKey(key,'phone-b',sha(recipient),sha(body))).toBeNull();
  expect(queue.originalByKey('another','phone-a',sha(recipient),sha(body))).toBeNull();
  expect(queue.originalByKey(key,'phone-a',sha('+15550000002'),sha(body))).toBeNull();
  expect(queue.originalByKey(key,'phone-a',sha(recipient),sha('different'))).toBeNull();
  expect(queue.originalByKey(key,'phone-a','not-a-hash',sha(body))).toBeNull();
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('APK sent callback is distinguishable from merely queued',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sms-original-callback-'));
 try{
  const queue=new AgentQueue(join(dir,'agent.sqlite'));
  queue.rememberDevice({id:'phone-a'});
  const task=queue.enqueue('phone-a','send_sms',recipient,body,key);
  expect(queue.claim('phone-a').map(t=>t.id)).toEqual([task.id]);
  expect(queue.finish('phone-a',task.id,'sent')).toBe(true);
  expect(queue.originalByKey(key,'phone-a',sha(recipient),sha(body))?.status).toBe('sent');
  // A conflicting original payload under same key must fail before any task mutation.
  expect(()=>queue.enqueue('phone-a','send_sms',recipient,'different body',key)).toThrow('idempotency_conflict');
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('Termux native original key is the same durable at-most-once row',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sms-original-termux-'));
 try{
  const queue=new SmsQueue(join(dir,'native.sqlite'),fakeTransport);
  const task=queue.enqueue(recipient,body,key);
  expect(queue.originalByKey(key,sha(recipient),sha(body))?.id).toBe(task.id);
  expect(queue.originalByKey(key,sha(recipient),sha(body))?.status).toBe('queued_for_device');
  expect(queue.originalByKey('wrong',sha(recipient),sha(body))).toBeNull();
  expect(queue.originalByKey(key,sha(recipient),sha('wrong'))).toBeNull();
  expect(queue.originalByKey(key,sha('+15550000009'),sha(body))).toBeNull();
  expect(()=>queue.enqueue(recipient,'different',key)).toThrow('idempotency_conflict');
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('unknown original key never creates a new SMS task',()=>{
 const dir=mkdtempSync(join(tmpdir(),'sms-original-unknown-'));
 try{
  const queue=new SmsQueue(join(dir,'native.sqlite'),fakeTransport);
  expect(queue.originalByKey(key,sha(recipient),sha(body))).toBeNull();
  expect(queue.counts()).toEqual({});
  const task=queue.enqueue(recipient,body,key);
  expect(queue.originalByKey(key,sha(recipient),sha(body))?.id).toBe(task.id);
  expect(queue.counts().queued_for_device).toBe(1);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
