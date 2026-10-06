export type GatewayHealth = {
  ok: boolean;
  android: boolean;
  agents: number;
  reason?: 'android_offline';
};

export function gatewayHealth(android: boolean, activeAgents: number): {
  body: GatewayHealth;
  status: 200 | 503;
} {
  const agents = Math.max(0, Math.trunc(activeAgents));
  const ok = android || agents > 0;
  return {
    body: { ok, android, agents, ...(ok ? {} : { reason: 'android_offline' as const }) },
    status: ok ? 200 : 503,
  };
}
