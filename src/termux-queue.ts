import { Database } from 'bun:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Task = { id: string; recipient: string; body: string; status: string; created: number; expires: number };
export interface Transport {
  ready(): Promise<boolean>;
  send(task: Task): Promise<boolean>;
}

/** A durable at-most-once dispatcher. Ambiguous attempts require human reconciliation. */
export class SmsQueue {
  private db: Database;
  private running = false;
  constructor(path: string, private transport: Transport) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path, { create: true });
    chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS sms_tasks (
        id TEXT PRIMARY KEY, dedupe TEXT UNIQUE, recipient TEXT NOT NULL, body TEXT NOT NULL,
        status TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL);
      UPDATE sms_tasks SET status='unknown' WHERE status='sending';`);
  }
  enqueue(to: string, body: string, key?: string, allowNew: () => boolean = () => true,
    expiresAt?: number): Task {
    const now = Date.now();
    // Exact retries without a key are deduplicated while the original is retained.
    const dedupe = createHash('sha256').update(key ? `key:${key}` : `body:${to}:${body}`).digest('hex');
    const old = this.db.query('SELECT * FROM sms_tasks WHERE dedupe=?').get(dedupe) as Task | null;
    if (old) {
      if (old.recipient !== to || old.body !== body) throw new Error('idempotency_conflict');
      return old;
    }
    if (!allowNew()) throw new Error('rate_limited');
    const task = { id: randomUUID(), recipient: to, body, status: 'queued_for_device', created: now,
      expires: Math.min(expiresAt ?? now + 600_000, now + 600_000) };
    this.db.query('INSERT INTO sms_tasks VALUES (?,?,?,?,?,?,?)').run(
      task.id, dedupe, to, body, task.status, now, task.expires,
    );
    return task;
  }
  get(id: string): Task | null {
    return this.db.query('SELECT * FROM sms_tasks WHERE id=?').get(id) as Task | null;
  }
  counts(): Record<string, number> {
    return Object.fromEntries((this.db.query('SELECT status, COUNT(*) AS n FROM sms_tasks GROUP BY status').all() as
      { status: string; n: number }[]).map(row => [row.status, row.n]));
  }
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      this.db.query("UPDATE sms_tasks SET status='expired' WHERE status='queued_for_device' AND expires<?").run(Date.now());
      const task = this.db.query("SELECT * FROM sms_tasks WHERE status='queued_for_device' ORDER BY created LIMIT 1").get() as Task | null;
      if (!task || !await this.transport.ready()) return;
      if (task.expires <= Date.now()) {
        this.db.query("UPDATE sms_tasks SET status='expired' WHERE id=?").run(task.id);
        return;
      }
      // Commit the dispatch lease before crossing the network: never repeat after uncertainty.
      this.db.query("UPDATE sms_tasks SET status='sending' WHERE id=? AND status='queued_for_device'").run(task.id);
      let status = 'unknown';
      try { if (await this.transport.send(task)) status = 'sent'; } catch { /* no retry, no payload logging */ }
      this.db.query('UPDATE sms_tasks SET status=? WHERE id=?').run(status, task.id);
    } catch { /* A preflight failure leaves queued work safe to inspect on the next tick. */ }
    finally { this.running = false; }
  }
  close(): void { this.db.close(); }
}

export function sentReceipt(raw: unknown, task: Task): boolean {
  const rows = Array.isArray(raw) ? raw : (raw as { messages?: unknown })?.messages;
  const zone = !Array.isArray(raw) && typeof (raw as { timezone?: unknown })?.timezone === 'string'
    ? (raw as { timezone: string }).timezone : '';
  if (!Array.isArray(rows)) return false;
  return rows.some(row => {
    const number = String(row.address ?? row.number ?? row.phone_number ?? '').replace(/\D/g, '');
    const stamp = row.date ?? row.received;
    const date = typeof stamp === 'number' ? stamp : Date.parse(String(stamp ?? '') + (row.received ? ` ${zone}` : ''));
    return number === task.recipient.replace(/\D/g, '') && row.body === task.body &&
      Number.isFinite(date) && date >= task.created - 5000 && (row.type === 'sent' || Number(row.type) === 2);
  });
}

/** The pinned SSH host key identifies the phone; the helper checks its Termux UID/model. */
export class SshTermuxTransport implements Transport {
  constructor(private host: string, private port: string, private user: string,
    private key: string, private knownHosts: string, private helper: string,
    private uid: string, private model: string, private hostKeyAlias?: string) {
    if (!/^[\w./-]+$/.test(helper) || !/^\d+$/.test(uid) || !/^[\w-]+$/.test(model)) {
      throw new Error('invalid_termux_configuration');
    }
  }
  private async call(mode: string, input = ''): Promise<string> {
    const process = Bun.spawn(['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5',
      '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=2', '-o', 'StrictHostKeyChecking=yes',
      '-o', `UserKnownHostsFile=${this.knownHosts}`, '-i', this.key, '-p', this.port,
      ...(this.hostKeyAlias ? ['-o', `HostKeyAlias=${this.hostKeyAlias}`] : []),
      `${this.user}@${this.host}`, `${this.helper} ${mode} ${this.uid} ${this.model}`],
    { stdin: new Blob([input]), stdout: 'pipe', stderr: 'pipe' });
    const timer = setTimeout(() => process.kill(), 45_000);
    try {
      const [stdout, , exit] = await Promise.all([
        new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited,
      ]);
      if (exit !== 0) throw new Error('termux_unavailable');
      return stdout;
    } finally { clearTimeout(timer); }
  }
  async ready(): Promise<boolean> {
    try {
      const result = JSON.parse(await this.call('probe'));
      return Array.isArray(result) || Array.isArray(result?.messages);
    } catch { return false; }
  }
  async send(task: Task): Promise<boolean> {
    const raw = await this.call('send', `${task.id}\n${task.recipient}\n${task.expires}\n${task.body}`);
    try { return sentReceipt(JSON.parse(raw), task); } catch { return false; }
  }
}
