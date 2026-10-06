import { describe, expect, test } from 'bun:test';
import { gatewayHealth } from './health';

describe('gatewayHealth', () => {
  test('reports degraded when no Android transport is reachable', () => {
    expect(gatewayHealth(false, 0)).toEqual({
      body: { ok: false, android: false, agents: 0, reason: 'android_offline' },
      status: 503,
    });
  });

  test('accepts either SSH Android or a polling agent', () => {
    expect(gatewayHealth(true, 0).status).toBe(200);
    expect(gatewayHealth(false, 1)).toEqual({
      body: { ok: true, android: false, agents: 1 },
      status: 200,
    });
  });
});
