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
`GET /health` returns HTTP 503 with `ok: false` while neither the pinned SSH
phone nor a recently polling APK agent is reachable. A running process alone
is not reported as healthy SMS delivery.

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

[`android/apk`](android/apk) is a small (~32 KB) installable Android agent. The
phone polls the gateway over WiFi for tasks, sends SMS through `SmsManager`
and relays every incoming SMS back — no USB cable, no Termux, survives reboot.

1. Build the APK: `cd android/apk && gradle assembleDebug` (Android SDK 34, Gradle 8.9).
2. Install it on the phone, open **SMS Agent**, and copy its displayed device ID
   into your authenticated UserIO phone setup. Enter the gateway URL and the
   device-only token returned by that setup, grant SMS permissions and disable
   battery optimization for reliable polling. Never put the shared gateway or
   UserIO service key on a user's phone.
3. The phone registers via `POST /agent/hello`, then long-cycles
   `GET /agent/tasks` every `AGENT_POLL_MS` seconds.

When the ADB phone is offline, `POST /v1/messages` automatically queues the
task for the agent instead of typing into Termux (`status: "queued_for_device"`).
Operator surface: `GET /v1/agent` lists phones, queue and recent results;
`POST /v1/agent/ping` queues a no-op task to verify a phone end-to-end.

APK version 1.1 has an addressed persistent queue: pass `device_id` from the
registered `sms:<device_id>` account to `POST /v1/messages` or
`POST /v1/agent/ping`. Another phone cannot consume that task. Polling commits
the dispatch lease before returning work; interrupted dispatch becomes `unknown`
after a gateway restart and is never automatically repeated. `sent` now requires
Android's SMS sent callback, while carrier/recipient delivery remains unconfirmed.
APK inbound messages are selected with `GET /v1/inbound?device_id=<id>`;
when SSH is configured, the unfiltered endpoint preserves the native phone's inbox.
The S21 keeps its pinned SSH Termux:API route and existing GSM2SIP voice route.

The same public `/agent/` route exposes `GET /agent/download` without a bearer
token, returning only the APK. Set `SMS_AGENT_APK_PATH` to the built APK path
when deployment keeps build output elsewhere. The configuration screen requires
the gateway URL and device token; never include the token in the download URL.
`POST /agent/hello` returns `account_registered:false` when UserIO registration
fails, and the phone re-registers every minute after connectivity returns.

The same SMS APK works on rooted and unrooted Android 8+ phones; root is not
required. It supports SMS, not voice calls. The operator's existing rooted S21
keeps its native SSH SMS and GSM2SIP voice routes. New-user APK enrollment uses
an opaque per-device token and an account scoped to that UserIO user; the APK's
URL/token fields are unchanged. See the [enrollment contract](docs/API.md).
APK1.1 relays newly received SMS while running; it does not backfill the phone's
old archive or retry an incoming upload lost before the gateway receives it.

The runtime budget is 128/256 MiB soft/hard RAM, no swap, one CPU, 64 tasks and
IOWeight 10. Before this change the service used 9.3 MiB and 12 tasks on
server-100; the budget includes concurrent bounded SSH preflights. The APK build
uses one Gradle worker, a 768 MiB JVM, two Java CPUs, no retained daemon, and a
180-second deadline. Version 1.1 built in about one minute with 44 GiB available
host RAM and 240 GiB disk free. Focused unit/API checks take two seconds, deadline
20 seconds, and exercise per-phone routing, crash/no-replay, expiry and native
receipt compatibility. Physical APK registration/ping is a separate integration
check (expected 30 seconds, maximum 90), with no SMS or cellular call.

To let phones work from anywhere (not just LAN), expose `/agent/*` on an
HTTPS domain via the reverse-proxy snippet in
[`deploy/nginx-sms-agent.conf`](deploy/nginx-sms-agent.conf) and point the app
at `https://<domain>/sms-gateway`; keep the gateway bound to `127.0.0.1`.

## Learn more

- [API](docs/API.md)
- [Russian setup](docs/README.ru.md)
