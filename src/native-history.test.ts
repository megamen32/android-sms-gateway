import { test, expect } from 'bun:test';
import { historyOptions, historyMessage } from './native-history';
import { SmsQueue } from './termux-queue';
import { mkdirSync } from 'node:fs';

test('history retains native identity, sent direction, short codes, read bit and dated body', () => {
  const row = { _id: 20, threadid: 7, type: 'sent', address: '900', body: 'fixture',
    received: '2026-10-12 02:00:00', read: true, sender: 'You' };
  const message = historyMessage(row, '+0300');
  expect(message.id).toBe('sms-native:20'); expect(message.direction).toBe('outgoing');
  expect(message.contact_number).toBe('900'); expect(message.provider_read).toBe(true);
  expect(message.receivedAt).toBe('2026-10-11T23:00:00.000Z');
  expect(historyMessage({ ...row, type: 'inbox', sender: 'Fixture contact' }, '+0300').contact_name).toBe('Fixture contact');
  expect(() => historyOptions(new URLSearchParams('limit=0'))).toThrow();
  expect(() => historyOptions(new URLSearchParams('after_id=1%20OR%201=1'))).toThrow();
});

test('receipt hydration requires unique provider row and exact recipient body and fresh time', async () => {
  mkdirSync('.tmp/native-history', { recursive: true });
  const queue = new SmsQueue(`.tmp/native-history/test-${crypto.randomUUID()}.sqlite`, { ready: async () => true, send: async () => true });
  const task = queue.enqueue('+15550000001', 'fixture'); await queue.tick();
  const row = historyMessage({ _id: 1, threadid: 1, type: 'sent', address: task.recipient,
    body: task.body, received: new Date(task.created).toISOString().replace('T', ' ').slice(0, 19), read: true }, '+0000');
  expect(queue.historyReceiptIds([row], false)).toEqual({});
  expect(queue.historyReceiptIds([{ ...row, body: 'different' }], true)).toEqual({});
  const duplicate = { ...row, id: 'sms-native:2', provider_id: '2' };
  expect(queue.historyReceiptIds([row, duplicate], true)).toEqual({});
  expect(queue.historyReceiptIds([row], true)).toEqual({ '1': task.id });
  expect(queue.historyReceiptIds([row], false)).toEqual({ '1': task.id });
  expect(queue.historyReceiptIds([{ ...row, date_ms: task.created - 60_000 }], true)).toEqual({});
  queue.close();
});
