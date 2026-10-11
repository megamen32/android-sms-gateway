import { Database } from 'bun:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type AgentTask = { id: string; device_id: string; type: string; to: string | null; body: string | null;
  createdAt: number; expires: number; status: string; error: string | null };

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
      UPDATE agent_tasks SET status='unknown' WHERE status='sending';`);
  }
  rememberDevice(device: { id: string }): void {
    this.db.query('INSERT OR REPLACE INTO agent_devices VALUES (?,?)').run(device.id, JSON.stringify(device));
  }
  devices(): unknown[] {
    return (this.db.query('SELECT metadata FROM agent_devices').all() as { metadata: string }[])
      .map(row => JSON.parse(row.metadata));
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
