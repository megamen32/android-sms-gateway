import { Database } from 'bun:sqlite';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type AgentTask = { id: string; device_id: string; type: string; to: string | null; body: string | null;
  createdAt: number; expires: number; status: string; error: string | null };
export type AgentBinding = { user_id: string; device_id: string; gateway_device_id: string; account_id: string };
export type AgentInbound = { id: string; device_id: string; account_id: string; user_id: string; sender: string; body: string; received: number };

export function enrollmentScope(user_id: string, device_id: string, account_id: string): AgentBinding {
  if (!user_id || user_id.length > 128 || !/^[\w.-]{1,100}$/.test(device_id)) throw new Error('invalid_agent_enrollment');
  const gateway_device_id = `user-${createHash('sha256').update(user_id).digest('hex').slice(0, 16)}-${device_id}`;
  if (account_id !== `sms:${gateway_device_id}`) throw new Error('agent_account_scope_mismatch');
  return { user_id, device_id, gateway_device_id, account_id };
}

/** Polling is a dispatch boundary: persist a lease before returning any task. */
export class AgentQueue {
  private db: Database;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path, { create: true }); chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS agent_tasks (id TEXT PRIMARY KEY, dedupe TEXT UNIQUE,
        device_id TEXT NOT NULL, type TEXT NOT NULL, recipient TEXT, body TEXT,
        createdAt INTEGER NOT NULL, expires INTEGER NOT NULL, status TEXT NOT NULL, error TEXT);
      CREATE TABLE IF NOT EXISTS agent_devices (id TEXT PRIMARY KEY, metadata TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agent_bindings (gateway_device_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL, device_id TEXT NOT NULL, account_id TEXT UNIQUE NOT NULL,
        token_hash TEXT UNIQUE NOT NULL, UNIQUE(user_id,device_id));
      CREATE TABLE IF NOT EXISTS agent_inbound (id TEXT PRIMARY KEY,device_id TEXT NOT NULL,
        account_id TEXT NOT NULL,user_id TEXT NOT NULL,sender TEXT NOT NULL,body TEXT NOT NULL,
        received INTEGER NOT NULL,delivered INTEGER NOT NULL DEFAULT 0,retry_at INTEGER NOT NULL DEFAULT 0);
      UPDATE agent_tasks SET status='unknown' WHERE status='sending';`);
  }
  rememberDevice(device: { id: string }): void {
    this.db.query('INSERT OR REPLACE INTO agent_devices VALUES (?,?)').run(device.id, JSON.stringify(device));
  }
  devices(): unknown[] {
    return (this.db.query('SELECT metadata FROM agent_devices').all() as { metadata: string }[])
      .map(row => JSON.parse(row.metadata));
  }
  enroll(binding: AgentBinding): AgentBinding & { device_token: string } {
    const device_token = 'sms_dev_' + randomBytes(32).toString('base64url');
    this.db.query(`INSERT INTO agent_bindings VALUES (?,?,?,?,?)
      ON CONFLICT(gateway_device_id) DO UPDATE SET token_hash=excluded.token_hash
      WHERE agent_bindings.user_id=excluded.user_id AND agent_bindings.device_id=excluded.device_id
        AND agent_bindings.account_id=excluded.account_id`).run(binding.gateway_device_id,
      binding.user_id,binding.device_id,binding.account_id,createHash('sha256').update(device_token).digest('hex'));
    if (!this.authenticate(device_token)) throw new Error('agent_enrollment_conflict');
    return { ...binding, device_token };
  }
  authenticate(token: string): AgentBinding | null {
    return this.db.query(`SELECT gateway_device_id,user_id,device_id,account_id FROM agent_bindings WHERE token_hash=?`)
      .get(createHash('sha256').update(token).digest('hex')) as AgentBinding | null;
  }
  bindingForDevice(device: string): AgentBinding | null {
    return this.db.query('SELECT gateway_device_id,user_id,device_id,account_id FROM agent_bindings WHERE gateway_device_id=?')
      .get(device) as AgentBinding | null;
  }
  rememberInbound(message: AgentInbound): void {
    this.db.query('INSERT OR IGNORE INTO agent_inbound (id,device_id,account_id,user_id,sender,body,received) VALUES (?,?,?,?,?,?,?)')
      .run(message.id,message.device_id,message.account_id,message.user_id,message.sender,message.body,message.received);
  }
  nextInbound(): AgentInbound | null {
    return this.db.query('SELECT * FROM agent_inbound WHERE delivered=0 AND retry_at<=? ORDER BY received LIMIT 1').get(Date.now()) as AgentInbound | null;
  }
  completeInbound(id: string, delivered: boolean): void {
    this.db.query('UPDATE agent_inbound SET delivered=?,retry_at=? WHERE id=?').run(delivered ? 1 : 0,Date.now()+15_000,id);
  }
  enqueue(device: string, type: string, to?: string, body?: string, key?: string,
    expires = Date.now() + 600_000, allowNew: () => boolean = () => true): AgentTask {
    const dedupe = createHash('sha256').update(key ? `key:${key}` : `${device}:${type}:${to}:${body}`).digest('hex');
    const old = this.db.query('SELECT *, recipient AS "to" FROM agent_tasks WHERE dedupe=?').get(dedupe) as AgentTask | null;
    if (old) {
      if (old.device_id !== device || old.type !== type || old.to !== (to ?? null) || old.body !== (body ?? null)) throw new Error('idempotency_conflict');
      return old;
    }
    if (!allowNew()) throw new Error('rate_limited');
    const id = randomUUID(), now = Date.now();
    this.db.query('INSERT INTO agent_tasks VALUES (?,?,?,?,?,?,?,?,?,NULL)').run(
      id, dedupe, device, type, to ?? null, body ?? null, now, Math.min(expires, now + 600_000), 'queued_for_device');
    return this.get(id)!;
  }
  get(id: string): AgentTask | null {
    return this.db.query('SELECT *, recipient AS "to" FROM agent_tasks WHERE id=?').get(id) as AgentTask | null;
  }
  claim(device: string): AgentTask[] {
    return this.db.transaction(() => {
      this.db.query("UPDATE agent_tasks SET status='expired' WHERE status='queued_for_device' AND expires<=?").run(Date.now());
      const tasks = this.db.query("SELECT *, recipient AS \"to\" FROM agent_tasks WHERE device_id=? AND status='queued_for_device' ORDER BY createdAt LIMIT 10").all(device) as AgentTask[];
      for (const task of tasks) this.db.query("UPDATE agent_tasks SET status='sending' WHERE id=?").run(task.id);
      return tasks;
    })();
  }
  finish(device: string, id: string, status: string, error?: string): boolean {
    const task = this.get(id);
    if (!task || task.device_id !== device) return false;
    if (task.status === status) return true;
    if (!['sending', 'unknown'].includes(task.status)) return false;
    if (!['sent', 'ok', 'failed', 'unknown'].includes(status)) return false;
    this.db.query('UPDATE agent_tasks SET status=?, error=? WHERE id=?').run(status, error?.slice(0, 200) ?? null, id);
    return true;
  }
  pending(): AgentTask[] {
    return this.db.query("SELECT *, recipient AS \"to\" FROM agent_tasks WHERE status='queued_for_device' ORDER BY createdAt LIMIT 100").all() as AgentTask[];
  }
  close() { this.db.close(); }
}
