export type SmsHistoryMessage = {
  id: string; provider_id: string; thread_id: string; direction: 'incoming' | 'outgoing';
  contact_number: string; contact_name: string; body: string; receivedAt: string; date_ms: number;
  type: string; provider_read: boolean; receipt_id?: string;
};

export function historyOptions(query: URLSearchParams) {
  const integer = (key: string, fallback: number) => {
    const raw = query.get(key);
    if (raw === null) return fallback;
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error('invalid_history_cursor');
    return Number(raw);
  };
  const limit = integer('limit', 100), after_id = integer('after_id', 0), snapshot_id = integer('snapshot_id', 0);
  if (limit < 1 || limit > 100) throw new Error('history_limit_must_be_1_to_100');
  const rawPending = query.get('pending_ids') || '';
  if (rawPending && !/^\d+(,\d+)*$/.test(rawPending)) throw new Error('invalid_history_pending_ids');
  if (rawPending && rawPending.split(',').length > 100) throw new Error('invalid_history_pending_ids');
  const pending_ids = rawPending ? [...new Set(rawPending.split(',').map(Number))] : [];
  if (pending_ids.length > 100 || pending_ids.some(id => !Number.isSafeInteger(id) || id < 1 || id > after_id)) {
    throw new Error('invalid_history_pending_ids');
  }
  return { limit, after_id, snapshot_id, pending_ids };
}

export function historyMessage(row: any, timezone: string): SmsHistoryMessage {
  if (!Number.isSafeInteger(row._id) || row._id < 1) throw new Error('invalid_native_provider_id');
  const date_ms = Date.parse(`${row.received} ${timezone}`);
  if (!Number.isFinite(date_ms)) throw new Error('invalid_native_message_date');
  const contact_number = String(row.address ?? row.number ?? '');
  return {
    id: `sms-native:${row._id}`, provider_id: String(row._id), thread_id: String(row.threadid),
    direction: row.type === 'inbox' ? 'incoming' : 'outgoing', contact_number,
    contact_name: row.sender && row.sender !== 'You' ? String(row.sender) : '',
    body: String(row.body ?? ''), receivedAt: new Date(date_ms).toISOString(), date_ms,
    type: String(row.type ?? ''), provider_read: row.read === true,
  };
}
