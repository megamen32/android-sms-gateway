import { test, expect } from 'bun:test';
import { historyOptions, historyMessage } from './native-history';
import { SmsQueue, SshTermuxTransport } from './termux-queue';
import { mkdirSync } from 'node:fs';

for (const pendingType of ['outbox', '']) {
  test(`incremental native history re-reads pending ${pendingType || 'queued'} without blocking a later inbox row`, async () => {
    const transport = new SshTermuxTransport('fixture', '22', 'fixture', 'fixture', 'fixture', '/fixture', '1', 'fixture');
    const rows = [
      { _id: 21, threadid: 1, type: pendingType, address: '900', body: 'outgoing fixture', received: '2026-10-12 02:00:00', read: true },
      { _id: 22, threadid: 1, type: 'inbox', address: '900', body: 'incoming fixture', received: '2026-10-12 02:00:01', read: false },
    ];
    const reads: string[] = [];
    (transport as any).call = async (mode: string, input: string) => {
      reads.push(mode);
      if (mode === 'history_snapshot') return JSON.stringify([{ _id: 22 }]);
      const [after, , pageLimit, ids] = input.split('\n');
      const requested = ids ? ids.split(',').map(Number) : [];
      return JSON.stringify({ timezone: '+0300', messages: rows.filter(row => row._id > Number(after)).slice(0, Number(pageLimit)),
        pending_messages: rows.filter(row => requested.includes(row._id)) });
    };
    const pending = await transport.history({ limit: 100, after_id: 20, snapshot_id: 0 });
    expect(pending.messages.map(message => message.provider_id)).toEqual(['22']);
    expect(pending.next_after_id).toBe(22);
    expect(pending.has_more).toBe(false);
    expect(pending.pending_ids).toEqual([21]);
    rows[0].type = 'sent';
    const settled = await transport.history({ limit: 100, after_id: pending.next_after_id, snapshot_id: 0, pending_ids: pending.pending_ids });
    expect(settled.messages.map(message => [message.provider_id, message.type])).toEqual([['21', 'sent']]);
    expect(settled.next_after_id).toBe(22);
    expect(settled.pending_ids).toEqual([]);
    expect(reads).toEqual(['history_snapshot', 'history', 'history_snapshot', 'history']);
  });
}

test('long pending SMS neither consumes the new page budget nor freezes later pages; deleted pending is cleared', async () => {
  const transport = new SshTermuxTransport('fixture', '22', 'fixture', 'fixture', 'fixture', '/fixture', '1', 'fixture');
  let retainPending = true;
  const calls: string[] = [];
  (transport as any).call = async (mode: string, input: string) => {
    calls.push(mode);
    if (mode === 'history_snapshot') return JSON.stringify([{ _id: 125 }]);
    const [after, , limit, requested] = input.split('\n');
    const row = (id: number, type = 'inbox') => ({ _id: id, threadid: 1, type, address: '900', body: 'fixture', received: '2026-10-12 02:00:00', read: false });
    return JSON.stringify({ timezone: '+0300', messages: Array.from({ length: 125 }, (_, i) => row(i + 1)).filter(row => row._id > Number(after)).slice(0, Number(limit)),
      pending_messages: requested && retainPending ? [row(21, 'outbox')] : [] });
  };
  const first = await transport.history({ limit: 100, after_id: 22, snapshot_id: 0, pending_ids: [21] });
  expect(first.messages.length).toBe(100); expect(first.next_after_id).toBe(122); expect(first.has_more).toBe(true);
  expect(first.pending_ids).toEqual([21]);
  const last = await transport.history({ limit: 100, after_id: 122, snapshot_id: first.snapshot_id, pending_ids: first.pending_ids });
  expect(last.messages.map(row => row.provider_id)).toEqual(['123', '124', '125']); expect(last.has_more).toBe(false);
  retainPending = false;
  const deleted = await transport.history({ limit: 100, after_id: 125, snapshot_id: 0, pending_ids: [21] });
  expect(deleted.pending_ids).toEqual([]); expect(deleted.next_after_id).toBe(125);
  expect(calls).toEqual(['history_snapshot', 'history', 'history', 'history_snapshot', 'history']);
});

test('fresh native request recovers after transport failure and refuses foreign pending provider IDs', async () => {
  const transport = new SshTermuxTransport('fixture', '22', 'fixture', 'fixture', 'fixture', '/fixture', '1', 'fixture');
  let failed = false, foreign = false;
  (transport as any).call = async (mode: string) => {
    if (!failed) { failed = true; throw new Error('termux_unavailable'); }
    if (mode === 'history_snapshot') return JSON.stringify([{ _id: 22 }]);
    const row = { _id: 21, threadid: 1, type: 'sent', address: '900', body: 'fixture', received: '2026-10-12 02:00:00', read: true };
    return JSON.stringify({ timezone: '+0300', messages: [], pending_messages: foreign ? [{ ...row, _id: 19 }] : [row] });
  };
  const options = { limit: 100, after_id: 22, snapshot_id: 0, pending_ids: [21] };
  await expect(transport.history(options)).rejects.toThrow('termux_unavailable');
  expect((await transport.history(options)).messages[0].provider_id).toBe('21');
  foreign = true;
  await expect(transport.history(options)).rejects.toThrow('invalid_native_history_pending');
});

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
  expect(historyOptions(new URLSearchParams('after_id=22&pending_ids=21,20')).pending_ids).toEqual([21, 20]);
  for (const query of ['after_id=22&pending_ids=21)OR(1=1', 'after_id=22&pending_ids=23', 'after_id=22&pending_ids=0',
    `after_id=200&pending_ids=${Array.from({ length: 101 }, (_, i) => i + 1).join(',')}`]) {
    expect(() => historyOptions(new URLSearchParams(query))).toThrow();
  }
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
