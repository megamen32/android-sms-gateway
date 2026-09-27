# Android SMS Gateway

[Русский](docs/README.ru.md) · [API](docs/API.md)

![Android SMS Gateway](docs/hero.svg)

> A small, authenticated verification API that sends through a pinned Android phone over SSH and Termux:API.

- Server-generated six-digit verification codes
- Authenticated text delivery for trusted integrations (for example, an approved UserIO draft)
- Android readiness endpoint and persistent submission receipts
- One pinned SSH phone; explicit `device_serial` rejects other devices
- Per-number and global rate limits
- Optional inbound SMS relay with a separate device token
- No telephone numbers, API keys, or delivery claims stored in the repository

## Install

```bash
SMS_GATEWAY_API_KEY=change-me ANDROID_SERIAL=your-adb-serial bun run start
```

## Start in minutes

1. Install Termux and Termux:API from the same distribution, then install `termux-api` inside Termux.
2. Grant Termux:API the `SEND_SMS` and `READ_PHONE_STATE` permissions.
3. Configure the SSH transport below, set the API environment variables, and start the server.

For inbound SMS, install `curl` in Termux, copy `android/inbound-agent.sh` to the phone, set `GATEWAY_URL` and `DEVICE_TOKEN`, then run it in Termux or Termux:Boot.

The server listens on `127.0.0.1:8787` by default. Put it behind HTTPS and keep the bearer key server-side.

`POST /v1/messages` lets a trusted bearer-token client queue one text SMS through the Android device.
It has the same rate limits as verification SMS and returns a receipt URL, never a carrier-delivery claim.

For an always-on local service, install [`deploy/android-sms-gateway.service`](deploy/android-sms-gateway.service), copy [`deploy/android-sms-gateway.env.example`](deploy/android-sms-gateway.env.example) to `/etc/android-sms-gateway.env` with mode `0600`, then enable it with systemd. Keep `HOST=127.0.0.1`: UserIO can call it locally without publishing its bearer API.

### Durable Termux transport

Install `android/ssh-sms-task.sh` on the verified phone as `~/.local/bin/sms-gateway-task` with mode `0700`.
Grant Termux:API the SMS read/send permissions it requires; current Termux:API also requires `READ_CONTACTS`
for sent-store queries. Configure the SSH host, pinned known-hosts file, private-key **path**, expected Termux
UID and model using `deploy/termux-ssh.conf.example` as a systemd drop-in for the existing gateway service.
Verify the physical serial when establishing that SSH trust; do not trust a model name alone.
`GET /v1/device` must report `online: true` before the first send. No foreground Termux window or ADB input is used.

`POST /v1/messages` returns a persistent queue ID, never a delivery claim. Supply a unique `Idempotency-Key`
per intended message and reuse it on HTTP retries. Optional `expires_at` (RFC3339 UTC with `Z` or `+00:00`)
bounds dispatch by the upstream OTP challenge deadline; the default/max queue lifetime is ten minutes.
Without a key, identical recipient/body pairs remain
deduplicated; use a new explicit key for an intentional repeat. Poll `GET /v1/messages/{id}`:

- `queued_for_device`: waiting for the configured phone; expires within ten minutes or the supplied deadline.
- `sending`: a durable dispatch lease was acquired.
- `sent`: exact recipient/body was found in the Android sent-store with a fresh timestamp.
- `unknown`: dispatch was ambiguous, including a gateway crash after leasing. **Never automatically retry.**
- `expired`: the queued message was never dispatched before its deadline.

`sent` proves Android sent-store submission, not recipient/carrier delivery. The API explicitly returns
`recipient_delivery_confirmed: false`. Queue state is mode `0600`, and the phone keeps a payload-free task
lease so the same task cannot send twice. OTP/message bodies travel through SSH stdin and are never logged.
The queue consumer runs inside the existing gateway process; do not start a separate worker daemon.

## APK agent (no ADB, no Termux)

[`android/apk`](android/apk) is a tiny (~18 KB) installable Android agent. The
phone polls the gateway over WiFi for tasks, sends SMS through `SmsManager`
and relays every incoming SMS back — no USB cable, no Termux, survives reboot.

1. Build the APK: `cd android/apk && gradle assembleDebug` (Android SDK 34, Gradle 8.9).
2. Install it on the phone, open **SMS Agent**, enter the gateway URL and the
   device token (`SMS_GATEWAY_DEVICE_TOKEN`), grant the SMS permissions and
   disable battery optimization for reliable polling.
3. The phone registers via `POST /agent/hello`, then long-cycles
   `GET /agent/tasks` every `AGENT_POLL_MS` seconds.

When the ADB phone is offline, `POST /v1/messages` automatically queues the
task for the agent instead of typing into Termux (`status: "queued_for_device"`).
Operator surface: `GET /v1/agent` lists phones, queue and recent results;
`POST /v1/agent/ping` queues a no-op task to verify a phone end-to-end.

To let phones work from anywhere (not just LAN), expose `/agent/*` on an
HTTPS domain via the reverse-proxy snippet in
[`deploy/nginx-sms-agent.conf`](deploy/nginx-sms-agent.conf) and point the app
at `https://<domain>/sms-gateway`; keep the gateway bound to `127.0.0.1`.

## Learn more

- [API](docs/API.md)
- [Russian setup](docs/README.ru.md)
