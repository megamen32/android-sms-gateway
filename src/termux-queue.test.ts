import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { SmsQueue, sentReceipt } from './termux-queue';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function path(): string {
  const root = mkdtempSync(join(tmpdir(), 'sms-queue-test-')); roots.push(root); return join(root, 'queue.sqlite');
}

test('restart preserves queue, exact HTTP retry identity, and dispatches only once', async () => {
  const db = path(); let sends = 0;
  const transport = { ready: async () => true, send: async () => { sends++; return true; } };
  let queue = new SmsQueue(db, transport);
  const first = queue.enqueue('+15550000001', 'sandbox-only', 'request-1');
  expect(queue.enqueue('+15550000001', 'sandbox-only', 'request-1').id).toBe(first.id);
  expect(() => queue.enqueue('+15550000001', 'different', 'request-1')).toThrow('idempotency_conflict');
  queue.close(); queue = new SmsQueue(db, transport);
  await Promise.all([queue.tick(), queue.tick()]);
  expect(sends).toBe(1); expect(queue.get(first.id)?.status).toBe('sent');
  queue.close(); queue = new SmsQueue(db, transport); await queue.tick(); expect(sends).toBe(1); queue.close();
});

test('ambiguous SSH result is terminal unknown across restart', async () => {
  const db = path(); let sends = 0;
  const transport = { ready: async () => true, send: async () => { sends++; throw new Error('connection lost'); } };
  let queue = new SmsQueue(db, transport);
  const task = queue.enqueue('+15550000001', 'sandbox-only'); await queue.tick();
  expect(queue.get(task.id)?.status).toBe('unknown'); queue.close();
  queue = new SmsQueue(db, transport); await queue.tick(); expect(sends).toBe(1); queue.close();
});

test('process crash after persisted lease never replays the SMS', async () => {
  const db = path(); let sends = 0;
  const transport = { ready: async () => true, send: async () => { sends++; return true; } };
  let queue = new SmsQueue(db, transport); const task = queue.enqueue('+15550000001', 'sandbox'); queue.close();
  const raw = new Database(db); raw.query("UPDATE sms_tasks SET status='sending' WHERE id=?").run(task.id); raw.close();
  queue = new SmsQueue(db, transport); await queue.tick();
  expect(queue.get(task.id)?.status).toBe('unknown'); expect(sends).toBe(0); queue.close();
});

test('offline preflight leaves work queued; expired OTP is never sent', async () => {
  const db = path(); let sends = 0;
  const queue = new SmsQueue(db, { ready: async () => false, send: async () => { sends++; return true; } });
  const task = queue.enqueue('+15550000001', 'sandbox'); await queue.tick();
  expect(queue.get(task.id)?.status).toBe('queued_for_device');
  const raw = new Database(db); raw.query('UPDATE sms_tasks SET expires=0 WHERE id=?').run(task.id); raw.close();
  await queue.tick(); expect(queue.get(task.id)?.status).toBe('expired'); expect(sends).toBe(0); queue.close();
});

test('only new work consumes rate budget and exact payload retries deduplicate', () => {
  const queue = new SmsQueue(path(), { ready: async () => false, send: async () => false });
  let budget = 0; const allow = () => ++budget === 1;
  const task = queue.enqueue('+15550000001', 'sandbox', undefined, allow);
  expect(queue.enqueue('+15550000001', 'sandbox', undefined, allow).id).toBe(task.id);
  expect(budget).toBe(1);
  expect(() => queue.enqueue('+15550000001', 'other', undefined, allow)).toThrow('rate_limited'); queue.close();
});

test('upstream challenge expiry bounds queued dispatch', () => {
  const queue = new SmsQueue(path(), { ready: async () => false, send: async () => false });
  const deadline = Date.now() + 20_000;
  expect(queue.enqueue('+15550000001', 'sandbox', 'expiry', () => true, deadline).expires).toBe(deadline);
  const capped = queue.enqueue('+15550000001', 'sandbox2', 'cap', () => true, Date.now() + 900_000);
  expect(capped.expires - capped.created).toBe(600_000); queue.close();
});

test('OTP expiring during phone preflight is discarded before the dispatch lease', async () => {
  const realNow = Date.now; const initial = realNow(); let now = initial; let sends = 0;
  Date.now = () => now;
  try {
    const queue = new SmsQueue(path(), {
      ready: async () => { now = initial + 30_000; return true; },
      send: async () => { sends++; return true; },
    });
    const task = queue.enqueue('+15550000001', 'sandbox', 'slow-probe', () => true, initial + 20_000);
    await queue.tick(); expect(queue.get(task.id)?.status).toBe('expired'); expect(sends).toBe(0); queue.close();
  } finally { Date.now = realNow; }
});

test('sent store receipt requires exact recipient, body and fresh timestamp', () => {
  const task = { id: 'test', recipient: '+15550000001', body: 'sandbox', status: 'sending', created: Date.now(), expires: Date.now() + 1000 };
  const row = { address: task.recipient, body: task.body, date: task.created, type: 2 };
  expect(sentReceipt([row], task)).toBe(true);
  expect(sentReceipt([{ ...row, address: '+15550000002' }], task)).toBe(false);
  expect(sentReceipt([{ ...row, date: task.created - 60_000 }], task)).toBe(false);
  expect(sentReceipt([{ ...row, type: 1 }], task)).toBe(false);
  expect(sentReceipt({ error: 'Permission required' }, task)).toBe(false);
  const phoneTask = { ...task, created: Date.parse('2026-09-28T01:00:00+03:00') };
  expect(sentReceipt({ timezone: '+0300', messages: [
    { address: task.recipient, body: task.body, type: 'sent', received: '2026-09-28 01:00:01' },
  ] }, phoneTask)).toBe(true);
});
