import { test, expect } from 'bun:test';
import { mkdirSync } from 'node:fs';

test('explicit APK account bypasses the native phone and reports registration failure honestly', async () => {
  mkdirSync('.tmp/agent-tests', { recursive: true });
  const suffix = crypto.randomUUID();
  const port = 19880 + Math.floor(Math.random() * 1000);
  const serverProcess = Bun.spawn([process.execPath, 'src/server.ts'], { env: {
    ...Bun.env, PORT: String(port), HOST: '127.0.0.1', SMS_GATEWAY_API_KEY: 'fixture-api',
    SMS_GATEWAY_DEVICE_TOKEN: 'fixture-device', ANDROID_SERIAL: 'native-fixture',
    SMS_SSH_HOST: '127.0.0.1', SMS_SSH_EXPECTED_UID: '10327',
    SMS_QUEUE_PATH: `.tmp/agent-tests/native-${suffix}.sqlite`,
    SMS_AGENT_QUEUE_PATH: `.tmp/agent-tests/agent-${suffix}.sqlite`,
    UNIVERSAL_USERIO_URL: '', USERIO_API_TOKEN: '',
  }, stdout: 'ignore', stderr: 'pipe' });
  const request = async (path: string, body?: object, agent = false) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer fixture-${agent ? 'device' : 'api'}`,
        'Content-Type': 'application/json', 'Idempotency-Key': 'per-phone-fixture' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() as any };
  };
  try {
    for (let i = 0; i < 40; i++) {
      try { await request('/v1/agent'); break; } catch { await Bun.sleep(25); }
    }
    const hello = await request('/agent/hello', { device_id: 'phone-a', model: 'fixture' }, true);
    expect(hello.body.account_registered).toBe(false);
    const accepted = await request('/v1/messages', { to: '+15550000001', body: 'offline fixture', device_id: 'phone-a' });
    expect(accepted.status).toBe(202);
    expect(accepted.body.device_id).toBe('phone-a');
    expect((await request('/agent/tasks?device_id=phone-b', undefined, true)).body.tasks).toEqual([]);
    const work = (await request('/agent/tasks?device_id=phone-a', undefined, true)).body.tasks;
    expect(work[0].id).toBe(accepted.body.id);
    expect((await request('/agent/tasks?device_id=phone-a', undefined, true)).body.tasks).toEqual([]);
    const receipt = await request('/agent/results', { device_id: 'phone-a', task_id: work[0].id, status: 'sent' }, true);
    expect(receipt.status).toBe(200);
    const status = await request(`/v1/messages/${work[0].id}`);
    expect(status.body.evidence).toBe('android_sms_sent_callback');
    expect(status.body.recipient_delivery_confirmed).toBe(false);
  } finally { serverProcess.kill(); await serverProcess.exited; }
}, 10_000);
