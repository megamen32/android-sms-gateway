import { createHash, randomInt, randomUUID } from 'node:crypto';
import { SmsQueue, SshTermuxTransport } from './termux-queue';
import { gatewayHealth } from './health';
import { AgentQueue, enrollmentScope, type AgentBinding } from './agent-queue';
import { historyOptions } from './native-history';

const port = Number(process.env.PORT || 8787);
const apiKey = process.env.SMS_GATEWAY_API_KEY;
const deviceToken = process.env.SMS_GATEWAY_DEVICE_TOKEN;
const defaultSerial = process.env.ANDROID_SERIAL;
if (!apiKey || !deviceToken || !defaultSerial) throw new Error('SMS_GATEWAY_API_KEY, SMS_GATEWAY_DEVICE_TOKEN and ANDROID_SERIAL are required');

type Verification = { id: string; to: string; deviceSerial: string; hash: string; expiresAt: number; status: 'queued_for_device' | 'verified'; attempts: number };
type Inbound = { id: string; from: string; body: string; receivedAt: string; device_id?: string };
type Device = { serial: string; state: string; model?: string };
// APK agent leg: phones poll for tasks instead of being driven over ADB.
type AgentDevice = { id: string; model?: string; phone?: string; lastSeen: number; tasksDone: number; tasksFailed: number; lastError?: string; registered?: boolean };
type AgentResult = { taskId: string; deviceId: string; status: string; error?: string; at: number };
const verifications = new Map<string, Verification>();
const inbound: Inbound[] = [];
const agentQueue = new AgentQueue(process.env.SMS_AGENT_QUEUE_PATH || './state/agents.sqlite');
const agentDevices = new Map<string, AgentDevice>();
for (const device of agentQueue.devices() as AgentDevice[]) agentDevices.set(device.id, device);
const agentResults: AgentResult[] = [];
const agentPollMs = Number(process.env.AGENT_POLL_MS || 15) * 1000;
const sends: number[] = []; const phoneSends = new Map<string, number[]>();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const json = (body: unknown, status = 200) => Response.json(body, { status });
const validPhone = (value: unknown): value is string => typeof value === 'string' && /^\+[1-9]\d{7,14}$/.test(value);
const termux = process.env.SMS_SSH_HOST ? new SshTermuxTransport(
  process.env.SMS_SSH_HOST, process.env.SMS_SSH_PORT || '22220', process.env.SMS_SSH_USER || 'roomhacker',
  process.env.SMS_SSH_KEY || '/home/roomhacker/.ssh/id_rsa',
  process.env.SMS_SSH_KNOWN_HOSTS || '/home/roomhacker/.ssh/known_hosts',
  process.env.SMS_SSH_HELPER || '/data/data/com.termux/files/home/.local/bin/sms-gateway-task',
  process.env.SMS_SSH_EXPECTED_UID || '', process.env.SMS_SSH_EXPECTED_MODEL || 'SM-G998B',
  process.env.SMS_SSH_HOST_KEY_ALIAS,
) : null;
const durableQueue = termux ? new SmsQueue(process.env.SMS_QUEUE_PATH || './state/sms.sqlite', termux) : null;
setInterval(() => { if (durableQueue) void durableQueue.tick(); void relayAgentInbound(); }, 3000);

async function devices(): Promise<Device[]> {
  const result = await Bun.$`adb devices -l`.quiet().nothrow();
  if (result.exitCode !== 0) return [];
  return result.stdout.toString().split('\n').slice(1).flatMap((line) => {
    const [serial, state, ...details] = line.trim().split(/\s+/);
    if (!serial || !state) return [];
    const model = details.find((detail) => detail.startsWith('model:'))?.slice('model:'.length);
    return [{ serial, state, ...(model ? { model } : {}) }];
  });
}
async function deviceOnline(serial: string) { return (await devices()).some((device) => device.serial === serial && device.state === 'device'); }
async function selectDevice(requested: unknown): Promise<{ serial?: string; error?: string; status?: number }> {
  if (requested !== undefined && (typeof requested !== 'string' || !requested.trim())) return { error: 'device_serial must be a non-empty string', status: 400 };
  const serial = typeof requested === 'string' ? requested.trim() : defaultSerial;
  if (termux) {
    if (serial !== defaultSerial) return { error: 'unknown_device_serial', status: 400 };
    return { serial };
  }
  const device = (await devices()).find((item) => item.serial === serial);
  if (!device) return { error: 'unknown_device_serial', status: 400 };
  if (device.state !== 'device') return { error: 'requested_android_is_offline', status: 503 };
  return { serial };
}
function allow(to: string) {
  const now = Date.now(); while (sends[0] && sends[0] < now - 3_600_000) sends.shift();
  const perPhone = (phoneSends.get(to) || []).filter((time) => time > now - 600_000);
  if (sends.length >= 20 || perPhone.length >= 3) return false;
  sends.push(now); perPhone.push(now); phoneSends.set(to, perPhone); return true;
}

// Register (or refresh) the phone agent as a UserIO account so the dashboard
// shows the device — model and SIM number when provided — under SMS.
async function registerAgentAccount(device: AgentDevice) {
  if (!process.env.UNIVERSAL_USERIO_URL || !process.env.USERIO_API_TOKEN) { device.registered = false; return; }
  const displayName = `SMS ${device.model || 'Android'}${device.phone ? ` · ${device.phone}` : ''}`;
  const payload = {
    id: `sms:${device.id}`, provider: 'sms', display_name: displayName,
    can_read: true, can_reply: true, credential_ref: `sms-agent:${device.id}`, enabled: true,
  };
  try {
    const response = await fetch(new URL('/v1/accounts', process.env.UNIVERSAL_USERIO_URL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.USERIO_API_TOKEN}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    device.registered = response.ok;
    if (!response.ok) device.lastError = `account_registration_http_${response.status}`;
  } catch (error) {
    device.registered = false;
    console.error('agent account registration failed:', error instanceof Error ? error.message : error);
  }
}

async function agentAccountBinding(binding: AgentBinding): Promise<{ registered: boolean; can_read: boolean; can_reply: boolean }> {
  if (!process.env.UNIVERSAL_USERIO_URL || !process.env.USERIO_API_TOKEN) throw new Error('userio_binding_unavailable');
  const url = new URL('/v1/sms/agent-binding', process.env.UNIVERSAL_USERIO_URL);
  url.search = new URLSearchParams({ user_id: binding.user_id, account_id: binding.account_id }).toString();
  const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.USERIO_API_TOKEN}` }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('userio_binding_unavailable');
  const status = await response.json() as any;
  if (typeof status.registered !== 'boolean' || typeof status.can_read !== 'boolean' || typeof status.can_reply !== 'boolean') throw new Error('invalid_userio_binding');
  return status;
}

let relayingInbound = false;
async function relayAgentInbound() {
  if (relayingInbound) return;
  const message = agentQueue.nextInbound(); if (!message) return;
  relayingInbound = true;
  let delivered = false;
  try {
    const binding = agentQueue.bindingForDevice(message.device_id);
    if (!binding || binding.user_id !== message.user_id || binding.account_id !== message.account_id) return;
    const status = await agentAccountBinding(binding);
    if (!status.registered || !status.can_read) return;
    const response = await fetch(new URL('/v1/messages', process.env.UNIVERSAL_USERIO_URL), {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.USERIO_API_TOKEN}` },
      body: JSON.stringify({ account_id: message.account_id, route_id: 'sms', message: {
        schema: 'universal.inbox.message.v1', source: 'sms', message_id: message.id,
        sender: message.sender, body: message.body, received_at: message.received / 1000, direction: 'incoming',
      } }), signal: AbortSignal.timeout(5000),
    });
    delivered = response.ok;
  } catch { /* Retry only the durable ingress callback; never send an SMS. */ }
  finally { agentQueue.completeInbound(message.id, delivered); relayingInbound = false; }
}

Bun.serve({ port, hostname: process.env.HOST || '127.0.0.1', async fetch(request, server) {
  const url = new URL(request.url);
  if (url.pathname === '/health') {
    const android = termux ? await termux.ready() : await deviceOnline(defaultSerial);
    const activeAgents = [...agentDevices.values()].filter(
      (device) => Date.now() - device.lastSeen <= Math.max(60_000, agentPollMs * 3),
    ).length;
    const health = gatewayHealth(android, activeAgents);
    return json(health.body, health.status);
  }
  // --- APK agent surface (device-token auth) -------------------------------
  if (['GET', 'HEAD'].includes(request.method) && url.pathname === '/agent/download') {
    const file = Bun.file(process.env.SMS_AGENT_APK_PATH || './android/apk/app/build/outputs/apk/debug/app-debug.apk');
    if (!await file.exists()) return json({ error: 'apk_unavailable' }, 503);
    return new Response(request.method === 'HEAD' ? null : file, { headers: {
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Disposition': 'attachment; filename="userio-sms-agent.apk"',
      'Content-Length': String(file.size),
      'Cache-Control': 'no-cache',
    } });
  }
  if (url.pathname.startsWith('/agent/')) {
    const authorization = request.headers.get('authorization') || '';
    const binding = authorization.startsWith('Bearer ') ? agentQueue.authenticate(authorization.slice(7)) : null;
    if (!binding && authorization !== `Bearer ${deviceToken}`) return json({ error: 'unauthorized_device' }, 401);
    const resolveDevice = (physical: string) => {
      if (binding) return physical === binding.device_id ? binding.gateway_device_id : '';
      // Legacy owner tokens cannot claim a scoped user's queue by its alias.
      return agentQueue.bindingForDevice(physical) ? '' : physical;
    };
    if (request.method === 'POST' && url.pathname === '/agent/hello') {
      const body = await request.json().catch(() => null) as { device_id?: unknown; model?: unknown; phone?: unknown } | null;
      const deviceId = resolveDevice(typeof body?.device_id === 'string' ? body.device_id.trim().slice(0, 128) : '');
      if (!deviceId) return json({ error: 'device_id required' }, 400);
      const device = agentDevices.get(deviceId) || { id: deviceId, tasksDone: 0, tasksFailed: 0, lastSeen: 0 };
      device.model = typeof body?.model === 'string' ? body.model.slice(0, 128) : device.model;
      device.phone = typeof body?.phone === 'string' ? body.phone.trim().slice(0, 24) : device.phone;
      device.lastSeen = Date.now();
      agentDevices.set(deviceId, device);
      if (binding) {
        try { device.registered = (await agentAccountBinding(binding)).registered; }
        catch { device.registered = false; }
      } else await registerAgentAccount(device);
      agentQueue.rememberDevice(device);
      return json({ ok: true, poll_ms: agentPollMs, account_registered: device.registered });
    }
    if (request.method === 'GET' && url.pathname === '/agent/tasks') {
      const deviceId = resolveDevice(url.searchParams.get('device_id')?.trim().slice(0, 128) || '');
      if (!deviceId) return json({ error: 'device_id required' }, 400);
      if (binding) {
        try { const status = await agentAccountBinding(binding); if (!status.registered || !status.can_reply) return json({ error: 'agent_account_unavailable' }, 403); }
        catch { return json({ error: 'userio_binding_unavailable' }, 503); }
      }
      const device = agentDevices.get(deviceId) || { id: deviceId, tasksDone: 0, tasksFailed: 0, lastSeen: 0 };
      device.lastSeen = Date.now(); agentDevices.set(deviceId, device);
      agentQueue.rememberDevice(device);
      const tasks = agentQueue.claim(deviceId);
      return json({ tasks: tasks.map(({ id, type, to, body }) => ({ id, type, to, body })) });
    }
    if (request.method === 'POST' && url.pathname === '/agent/results') {
      const body = await request.json().catch(() => null) as { task_id?: unknown; device_id?: unknown; status?: unknown; error?: unknown } | null;
      const taskId = typeof body?.task_id === 'string' ? body.task_id : '';
      const deviceId = resolveDevice(typeof body?.device_id === 'string' ? body.device_id.slice(0, 128) : '');
      if (!taskId || !deviceId || typeof body?.status !== 'string') return json({ error: 'task_id, device_id and status required' }, 400);
      const previous = agentQueue.get(taskId);
      if (!agentQueue.finish(deviceId, taskId, body.status, typeof body.error === 'string' ? body.error : undefined)) {
        return json({ error: 'unknown_task_or_result_conflict' }, 409);
      }
      if (previous?.status === body.status) return json({ ok: true });
      const device = agentDevices.get(deviceId) || { id: deviceId, tasksDone: 0, tasksFailed: 0, lastSeen: Date.now() };
      device.lastSeen = Date.now();
      if (body.status === 'sent' || body.status === 'ok') device.tasksDone += 1;
      else { device.tasksFailed += 1; device.lastError = String(body.error || body.status).slice(0, 200); }
      agentDevices.set(deviceId, device);
      agentQueue.rememberDevice(device);
      agentResults.unshift({ taskId, deviceId, status: body.status, error: typeof body.error === 'string' ? body.error.slice(0, 200) : undefined, at: Date.now() });
      agentResults.splice(50);
      return json({ ok: true });
    }
    if (request.method === 'POST' && url.pathname === '/agent/inbound') {
      const body = await request.json().catch(() => null) as { device_id?: unknown; from?: unknown; body?: unknown; received_at?: unknown } | null;
      const deviceId = resolveDevice(typeof body?.device_id === 'string' ? body.device_id.slice(0, 128) : '');
      if (!deviceId || typeof body?.from !== 'string' || !body.from.trim() || body.from.length > 128 || typeof body?.body !== 'string' || !body.body.trim()) {
        return json({ error: 'device_id, sender address and body required' }, 400);
      }
      const receivedMs = typeof body?.received_at === 'number' ? body.received_at : typeof body?.received_at === 'string' ? Date.parse(body.received_at) : Date.now();
      const id = hash(`${deviceId}:${body.from}:${receivedMs}:${body.body}`);
      if (binding) {
        try { const status = await agentAccountBinding(binding); if (!status.registered || !status.can_read) return json({ error: 'agent_account_unavailable' }, 403); }
        catch { return json({ error: 'userio_binding_unavailable' }, 503); }
        agentQueue.rememberInbound({ id,device_id:deviceId,account_id:binding.account_id,user_id:binding.user_id,
          sender:body.from,body:body.body.slice(0,1600),received:Number.isFinite(receivedMs)?receivedMs:Date.now() });
        void relayAgentInbound();
        return json({ accepted: true, message_id: id });
      }
      if (!inbound.some((stored) => stored.id === id)) {
        inbound.unshift({ id, from: body.from, body: body.body.slice(0, 1600), device_id: deviceId, receivedAt: new Date(Number.isFinite(receivedMs) ? receivedMs : Date.now()).toISOString() });
        inbound.splice(100);
      }
      return json({ accepted: true });
    }
    return json({ error: 'not_found' }, 404);
  }
  if (request.method === 'POST' && url.pathname === '/v1/device/inbound') {
    if (request.headers.get('authorization') !== `Bearer ${deviceToken}`) return json({ error: 'unauthorized_device' }, 401);
    const body = await request.json().catch(() => null) as { messages?: unknown } | null;
    if (!Array.isArray(body?.messages)) return json({ error: 'messages must be an array' }, 400);
    let accepted = 0;
    for (const item of body.messages.slice(0, 100)) {
      if (!item || typeof item !== 'object') continue;
      const message = item as Record<string, unknown>;
      const from = message.number ?? message.address;
      const receivedMs = typeof message.date === 'number' ? message.date : typeof message.date === 'string' ? Date.parse(message.date) : NaN;
      if (!validPhone(from) || typeof message.body !== 'string' || !Number.isFinite(receivedMs)) continue;
      const id = hash(`${from}:${receivedMs}:${message.body}`);
      if (inbound.some((stored) => stored.id === id)) continue;
      inbound.unshift({ id, from, body: message.body.slice(0, 1600), receivedAt: new Date(receivedMs).toISOString() }); accepted += 1;
    }
    inbound.splice(100); return json({ accepted });
  }
  if (request.headers.get('authorization') !== `Bearer ${apiKey}`) return json({ error: 'unauthorized' }, 401);
  if (request.method === 'POST' && url.pathname === '/v1/agent/enroll') {
    const body = await request.json().catch(() => null) as any;
    let binding: AgentBinding;
    try { binding = enrollmentScope(typeof body?.user_id === 'string' ? body.user_id : '',
      typeof body?.device_id === 'string' ? body.device_id : '', typeof body?.account_id === 'string' ? body.account_id : ''); }
    catch (error) { return json({ error: error instanceof Error ? error.message : 'invalid_agent_enrollment' }, 400); }
    try {
      if (!(await agentAccountBinding(binding)).registered) return json({ error: 'agent_account_not_registered' }, 403);
      return json(agentQueue.enroll(binding), 201);
    } catch { return json({ error: 'userio_binding_unavailable' }, 503); }
  }
  if (request.method === 'GET' && url.pathname === '/v1/history') {
    // Two bounded SSH calls may take up to 60s. Bun's default 10s idle timer closes an active read early.
    server.timeout(request, 75);
    let options;
    try { options = historyOptions(url.searchParams); }
    catch (error) { return json({ error: error instanceof Error ? error.message : 'invalid_history_query' }, 400); }
    if (!termux) return json({ error: 'native_history_not_configured' }, 503);
    try {
      const page = await termux.history(options);
      const receipts = durableQueue?.historyReceiptIds(page.messages, options.after_id === 0 && !page.has_more && !page.pending_ids.length) || {};
      for (const message of page.messages) if (receipts[message.provider_id]) message.receipt_id = receipts[message.provider_id];
      return json({ ...page, device_serial: defaultSerial, transport: 'ssh-termux-api', after_id: options.after_id });
    } catch { return json({ error: 'native_history_unavailable' }, 503); }
  }
  if (request.method === 'GET' && url.pathname === '/v1/device') return json({ serial: defaultSerial,
    online: termux ? await termux.ready() : await deviceOnline(defaultSerial), transport: termux ? 'ssh-termux-api' : 'apk-agent' });
  if (request.method === 'GET' && url.pathname === '/v1/devices') return json({ default_serial: defaultSerial, devices: await devices(), transport: 'adb-termux-api' });
  if (request.method === 'GET' && url.pathname === '/v1/inbound') {
    const deviceId = url.searchParams.get('device_id');
    return json({ messages: deviceId ? inbound.filter(message => message.device_id === deviceId) :
      termux ? inbound.filter(message => !message.device_id) : inbound,
      retention: 'memory-only, maximum 100 messages' });
  }
  if (request.method === 'POST' && url.pathname === '/v1/verifications') {
    const body = await request.json().catch(() => null) as { to?: unknown; device_serial?: unknown } | null;
    if (!validPhone(body?.to)) return json({ error: 'to must be E.164' }, 400);
    const selected = await selectDevice(body?.device_serial);
    if (!selected.serial) return json({ error: selected.error }, selected.status);
    if (!allow(body.to)) return json({ error: 'rate_limited' }, 429);
    if (!durableQueue) return json({ error: 'ssh_transport_not_configured' }, 503);
    const code = String(randomInt(100000, 1000000));
    const task = durableQueue.enqueue(body.to, `Your verification code: ${code}`);
    const id = task.id;
    const verification: Verification = { id, to: body.to, deviceSerial: selected.serial, hash: hash(code), expiresAt: Date.now() + 300_000, status: 'queued_for_device', attempts: 0 };
    verifications.set(id, verification);
    return json({ id, device_serial: verification.deviceSerial, status: verification.status,
      expiresAt: new Date(verification.expiresAt).toISOString() }, 201);
  }
  if (request.method === 'POST' && url.pathname === '/v1/messages') {
    const body = await request.json().catch(() => null) as {
      to?: unknown; body?: unknown; device_serial?: unknown; device_id?: unknown; expires_at?: unknown;
    } | null;
    if (!validPhone(body?.to)) return json({ error: 'to must be E.164' }, 400);
    if (typeof body?.body !== 'string' || !body.body.trim() || body.body.length > 480) {
      return json({ error: 'body must be non-empty and at most 480 characters' }, 400);
    }
    if (body.device_id !== undefined && (typeof body.device_id !== 'string' || !body.device_id.trim())) {
      return json({ error: 'device_id must be a non-empty string' }, 400);
    }
    const serial = typeof body?.device_serial === 'string' && body.device_serial.trim() ? body.device_serial.trim() : defaultSerial;
    const agentId = typeof body?.device_id === 'string' ? body.device_id.trim() :
      serial.startsWith('sms-agent:') ? serial.slice('sms-agent:'.length) : '';
    if (agentId) {
      if (!agentDevices.has(agentId)) return json({ error: 'unknown_agent_device' }, 400);
      const key = request.headers.get('Idempotency-Key') || undefined;
      if (key && key.length > 200) return json({ error: 'invalid_idempotency_key' }, 400);
      const expires = body.expires_at === undefined ? Date.now() + 600_000 :
        typeof body.expires_at === 'string' && /(?:Z|\+00:00)$/.test(body.expires_at) ? Date.parse(body.expires_at) : NaN;
      if (!Number.isFinite(expires) || expires <= Date.now()) return json({ error: 'message_expired_or_invalid_expiry' }, 400);
      try {
        const task = agentQueue.enqueue(agentId, 'send_sms', body.to, body.body.trim(), key, expires, () => allow(body.to as string));
        return json({ id: task.id, status: task.status, device_id: agentId, status_url: `/v1/messages/${task.id}` }, 202);
      } catch (error) {
        const code = error instanceof Error ? error.message : 'queue_unavailable';
        return json({ error: code }, code === 'rate_limited' ? 429 : code === 'idempotency_conflict' ? 409 : 503);
      }
    }
    if (durableQueue) {
      if (serial !== defaultSerial) return json({ error: 'unknown_device_serial' }, 400);
      const key = request.headers.get('Idempotency-Key') || undefined;
      if (key && key.length > 200) return json({ error: 'invalid_idempotency_key' }, 400);
      const expiresAt = body.expires_at === undefined ? undefined :
        typeof body.expires_at === 'string' &&
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$/.test(body.expires_at)
          ? Date.parse(body.expires_at) : NaN;
      if (expiresAt !== undefined && (!Number.isFinite(expiresAt) || expiresAt <= Date.now())) {
        return json({ error: 'message_expired_or_invalid_expiry' }, 400);
      }
      // Rate-limit new work only; a retry must be able to recover the original receipt.
      try {
        const task = durableQueue.enqueue(body.to, body.body.trim(), key, () => allow(body.to as string), expiresAt);
        return json({ id: task.id, status: task.status, device_serial: serial,
          status_url: `/v1/messages/${task.id}` }, 202);
      } catch (error) {
        const code = error instanceof Error ? error.message : '';
        return json({ error: code === 'rate_limited' ? code : code === 'idempotency_conflict' ? code : 'queue_unavailable' },
          code === 'rate_limited' ? 429 : code === 'idempotency_conflict' ? 409 : 503);
      }
    }
    // Legacy APK mode is usable only with a live polling consumer. Never inject UI commands.
    const agentAlive = [...agentDevices.values()].some((device) => Date.now() - device.lastSeen < 60_000);
    if (agentAlive) {
      if (!allow(body.to)) return json({ error: 'rate_limited' }, 429);
      const online = [...agentDevices.values()].filter(device => Date.now() - device.lastSeen < 60_000);
      if (online.length !== 1) return json({ error: 'device_id_required' }, 400);
      const task = agentQueue.enqueue(online[0].id, 'send_sms', body.to, body.body.trim(), request.headers.get('Idempotency-Key') || undefined);
      return json({ id: task.id, status: task.status, device_id: online[0].id }, 202);
    }
    return json({ error: 'sms_consumer_unavailable' }, 503);
  }
  const messageMatch = url.pathname.match(/^\/v1\/messages\/([\w-]+)$/);
  if (request.method === 'GET' && messageMatch) {
    const apkTask = agentQueue.get(messageMatch[1]);
    if (apkTask) return json({ id: apkTask.id, status: apkTask.status, device_id: apkTask.device_id,
      evidence: apkTask.status === 'sent' ? 'android_sms_sent_callback' : null, recipient_delivery_confirmed: false });
    const task = durableQueue?.get(messageMatch[1]);
    return task ? json({ id: task.id, status: task.status,
      evidence: task.status === 'sent' ? 'android_sent_store' : null,
      recipient_delivery_confirmed: false }) : json({ error: 'not_found' }, 404);
  }
  if (request.method === 'GET' && url.pathname === '/v1/agent') {
    return json({
      devices: [...agentDevices.values()],
      queue: agentQueue.pending().map(({ id, device_id, type, to, createdAt }) => ({ id, device_id, type, to, createdAt })),
      results: agentResults.slice(0, 20),
      durable_queue: durableQueue?.counts() || {},
    });
  }
  // Queue a no-op task to verify a phone agent's poll-execute-report loop.
  if (request.method === 'POST' && url.pathname === '/v1/agent/ping') {
    const body = await request.json().catch(() => null) as { device_id?: unknown } | null;
    const deviceId = typeof body?.device_id === 'string' ? body.device_id : '';
    if (!agentDevices.has(deviceId)) return json({ error: 'known_device_id_required' }, 400);
    const task = agentQueue.enqueue(deviceId, 'ping', undefined, undefined, randomUUID());
    return json({ id: task.id, device_id: deviceId }, 202);
  }
  const match = url.pathname.match(/^\/v1\/verifications\/([\w-]+)\/check$/);
  if (request.method === 'POST' && match) {
    const verification = verifications.get(match[1]); const body = await request.json().catch(() => null) as { code?: unknown } | null;
    if (!verification || verification.expiresAt < Date.now()) return json({ error: 'expired_or_unknown' }, 404);
    if (++verification.attempts > 5) return json({ error: 'too_many_attempts' }, 429);
    if (typeof body?.code !== 'string' || hash(body.code) !== verification.hash) return json({ verified: false }, 422);
    verification.status = 'verified'; return json({ verified: true });
  }
  return json({ error: 'not_found' }, 404);
}});
console.log(`android-sms-gateway listening on ${port}`);
