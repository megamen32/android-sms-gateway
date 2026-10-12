# API

## Native phone history

`GET /v1/history?limit=100&after_id=0` reads the pinned phone's actual Android
SMS provider through the existing SSH/Termux:API transport. It performs no send
and does not mark messages read. This is the archive/backfill route; the older
`/v1/inbound` is an in-memory relay of recent incoming events.

The authenticated response contains `messages`, `snapshot_id`, `next_after_id`,
`has_more`, `after_id`, `order: "provider_id_asc"`, `timezone`,
`timestamp_precision: "second"`, `device_serial`, and `transport`.
Each message contains `id: "sms-native:<Android _id>"`, `provider_id`,
`thread_id`, `direction`, `contact_number`, `contact_name`, `body`, `receivedAt`
(UTC ISO timestamp), `date_ms`, `type`, and `provider_read`.
Numbers, short codes and named sender addresses are preserved. Contact names
are optional: the native API can return a known incoming contact's name, but
uses `You` for outgoing rows, which is not exposed as a contact name.

`limit` is 1–100. Continue with the returned `next_after_id` and the same
`snapshot_id` until `has_more` is false. The fixed upper ID prevents new arrivals
from shifting pages. Start the next incremental read with the previous final
ID and omit `snapshot_id` (or use zero) to obtain a new upper bound. Invalid
cursors return 400, and unavailable native history returns 503.

For continuous synchronization, persist `pending_ids` alongside `next_after_id`.
Pass those IDs as `pending_ids=21,23` on subsequent pages and polls (at most 100
positive IDs, each at or below `after_id`). Android changes outbox/queued rows
to sent in place, without allocating a new ID. The response's `pending_ids`
contains rows still waiting for that transition. Pending rows are omitted from
`messages`; settled pending rows are merged into `messages` even when their IDs
are below the new-row cursor. Such old IDs can only be from the requested pending
set. A deleted pending row is removed from the set. The new-page watermark and
`has_more` advance independently, so one long-queued SMS never blocks later
incoming pages. Native provider IDs remain the deduplication identity.

Allow a bounded **65-second** client timeout for this route. Snapshot SSH is
bounded to 20 seconds; a page plus
optional pending recheck is bounded to 40 seconds. Only this HTTP request gets a
75-second Bun idle timeout; other routes retain their existing timeout. A read
failure or pending set exceeding 100 returns 503: retain both previous cursor
and pending set and retry the read, never a send. Every HTTP request opens new
pinned SSH calls and reads the current provider; there is no history cache.

Optional `receipt_id` links an outgoing Android row to an existing durable
gateway receipt. A new link is created only when a complete stable snapshot
fits in the first bounded page and exactly one sent task matches exactly one
provider row by recipient, body and fresh creation/expiry window. That link is
durable and revalidated on later reads. Ambiguous matches remain unlinked; two
real messages with identical text retain different native IDs. This endpoint
never merges messages by body or replays dispatch. Larger legacy snapshots may
have unlinked receipts until independent uniqueness evidence exists.

The installed GSM2SIP app also retains its own recent mixed call/SMS traffic
view (500 entries) and forwards SMS and delivery reports via SIP MESSAGE. That
view is not the complete Android SMS provider: its pending queues expire or
remove accepted entries, and the current SIP/AMI surface exposes no archive
query. This endpoint reuses the native system store; it adds no Android worker
and changes no SIP or AutoFind routing.

Native API exposure and ordering are defined by the
[official Termux API source](https://github.com/termux/termux-api/blob/master/app/src/main/java/com/termux/api/apis/SmsInboxAPI.java).

Every `/v1/*` request needs `Authorization: Bearer <SMS_GATEWAY_API_KEY>`.

`GET /v1/devices` lists ADB devices visible to the gateway and identifies `default_serial` from `ANDROID_SERIAL`. Only devices whose ADB state is `device` can send SMS.

`POST /v1/verifications` with `{ "to": "+79990000000", "device_serial": "optional-adb-serial" }` creates a five-minute code and asks the selected Android to send it. Omitting `device_serial` uses the configured default. An unknown or offline serial is rejected before an SMS command is entered. The response status `accepted_by_android` means the phone accepted the command; it is not a carrier delivery receipt.

`POST /v1/verifications/{id}/check` with `{ "code": "123456" }` verifies a code. There are at most three sends per phone per ten minutes, twenty total per hour, and five code attempts.

`POST /v1/messages` with `{ "to": "+79990000000", "body": "Approved reply", "device_serial": "optional-adb-serial" }` sends one trusted, authenticated text message. Its body is limited to 480 characters and it uses the same limits. A `202` with `accepted_by_android` confirms Android accepted the command, not carrier delivery.

`GET /v1/device` reports paired serial and ADB reachability. `GET /health` needs no key and is safe for a local health check.

The Android agent posts inbox records to `POST /v1/device/inbound` with its separate device bearer token. `GET /v1/inbound` returns the last 100 received messages to the normal API client. Inbox data is memory-only in this first deployment and disappears on restart.
