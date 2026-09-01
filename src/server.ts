import { createHash, randomUUID } from 'node:crypto';

const port = Number(process.env.PORT || 8787);
const apiKey = process.env.SMS_GATEWAY_API_KEY;
const deviceToken = process.env.SMS_GATEWAY_DEVICE_TOKEN;
const serial = process.env.ANDROID_SERIAL;
if (!apiKey || !deviceToken || !serial) throw new Error('SMS_GATEWAY_API_KEY, SMS_GATEWAY_DEVICE_TOKEN and ANDROID_SERIAL are required');

type Verification = { id: string; to: string; hash: string; expiresAt: number; status: 'accepted_by_android' | 'verified'; attempts: number };
type Inbound = { id: string; from: string; body: string; receivedAt: string };
const verifications = new Map<string, Verification>();
const inbound: Inbound[] = [];
const sends: number[] = []; const phoneSends = new Map<string, number[]>();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const json = (body: unknown, status = 200) => Response.json(body, { status });
const validPhone = (value: unknown): value is string => typeof value === 'string' && /^\+[1-9]\d{7,14}$/.test(value);
const quoteInput = (value: string) => value.replace(/[^\p{L}\p{N} .,:;!?@_+\-]/gu, '').replace(/ /g, '%s');

async function deviceOnline() { const result = await Bun.$`adb -s ${serial} get-state`.quiet().nothrow(); return result.exitCode === 0 && result.stdout.toString().trim() === 'device'; }
async function sendWithAndroid(to: string, message: string) {
  if (!await deviceOnline()) throw new Error('Android is offline');
  const entered = await Bun.$`adb -s ${serial} shell input text ${quoteInput(`termux-sms-send -n ${to} ${message}`)}`.quiet().nothrow();
  if (entered.exitCode !== 0) throw new Error('Could not enter SMS command on Android');
  const run = await Bun.$`adb -s ${serial} shell input keyevent ENTER`.quiet().nothrow();
  if (run.exitCode !== 0) throw new Error('Could not execute SMS command on Android');
}
function allow(to: string) {
  const now = Date.now(); while (sends[0] && sends[0] < now - 3_600_000) sends.shift();
  const perPhone = (phoneSends.get(to) || []).filter((time) => time > now - 600_000);
  if (sends.length >= 20 || perPhone.length >= 3) return false;
  sends.push(now); perPhone.push(now); phoneSends.set(to, perPhone); return true;
}

Bun.serve({ port, hostname: process.env.HOST || '127.0.0.1', async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === '/health') return json({ ok: true, android: await deviceOnline() });
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
  if (request.method === 'GET' && url.pathname === '/v1/device') return json({ serial, online: await deviceOnline(), transport: 'adb-termux-api' });
  if (request.method === 'GET' && url.pathname === '/v1/inbound') return json({ messages: inbound, retention: 'memory-only, maximum 100 messages' });
  if (request.method === 'POST' && url.pathname === '/v1/verifications') {
    const body = await request.json().catch(() => null) as { to?: unknown } | null;
    if (!validPhone(body?.to)) return json({ error: 'to must be E.164' }, 400);
    if (!allow(body.to)) return json({ error: 'rate_limited' }, 429);
    const code = String(Math.floor(100000 + Math.random() * 900000)); const id = randomUUID();
    const verification: Verification = { id, to: body.to, hash: hash(code), expiresAt: Date.now() + 300_000, status: 'accepted_by_android', attempts: 0 };
    try { await sendWithAndroid(body.to, `Your verification code: ${code}`); verifications.set(id, verification); return json({ id, status: verification.status, expiresAt: new Date(verification.expiresAt).toISOString() }, 201); }
    catch (error) { return json({ error: error instanceof Error ? error.message : 'send_failed' }, 503); }
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
