import { test, expect } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { AgentQueue } from './agent-queue';

function path() { mkdirSync('.tmp/agent-tests', { recursive: true }); return `.tmp/agent-tests/${crypto.randomUUID()}.sqlite`; }

test('APK work belongs to its phone and remains observable without replay after restart', () => {
  const db = path(); let queue = new AgentQueue(db);
  const task = queue.enqueue('phone-a', 'send_sms', '+15550000001', 'offline fixture', 'request-a');
  expect(queue.claim('phone-b')).toEqual([]);
  expect(queue.claim('phone-a')[0].id).toBe(task.id);
  expect(queue.claim('phone-a')).toEqual([]);
  queue.close(); queue = new AgentQueue(db);
  expect(queue.get(task.id)?.status).toBe('unknown');
  expect(queue.claim('phone-a')).toEqual([]);
  expect(queue.enqueue('phone-a', 'send_sms', '+15550000001', 'offline fixture', 'request-a').id).toBe(task.id);
  expect(queue.finish('phone-b', task.id, 'sent')).toBe(false);
  expect(queue.finish('phone-a', task.id, 'sent')).toBe(true);
  expect(queue.get(task.id)?.status).toBe('sent');
  expect(queue.finish('phone-a', task.id, 'failed')).toBe(false);
  queue.close();
});

test('expired APK work cannot be claimed and idempotency cannot redirect the phone', () => {
  const queue = new AgentQueue(path());
  const old = queue.enqueue('phone-a', 'send_sms', '+15550000001', 'fixture', 'expired', Date.now() - 1);
  expect(queue.claim('phone-a')).toEqual([]);
  expect(queue.get(old.id)?.status).toBe('expired');
  queue.enqueue('phone-a', 'send_sms', '+15550000001', 'fixture', 'same');
  expect(() => queue.enqueue('phone-b', 'send_sms', '+15550000001', 'fixture', 'same')).toThrow('idempotency_conflict');
  queue.close();
});
