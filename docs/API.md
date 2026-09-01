# API

Every `/v1/*` request needs `Authorization: Bearer <SMS_GATEWAY_API_KEY>`.

`POST /v1/verifications` with `{ "to": "+79990000000" }` creates a five-minute code and asks the connected Android to send it. The response status `accepted_by_android` means the phone accepted the command; it is not a carrier delivery receipt.

`POST /v1/verifications/{id}/check` with `{ "code": "123456" }` verifies a code. There are at most three sends per phone per ten minutes, twenty total per hour, and five code attempts.

`POST /v1/messages` with `{ "to": "+79990000000", "body": "Approved reply" }` sends one trusted, authenticated text message. Its body is limited to 480 characters and it uses the same limits. A `202` with `accepted_by_android` confirms Android accepted the command, not carrier delivery.

`GET /v1/device` reports paired serial and ADB reachability. `GET /health` needs no key and is safe for a local health check.

The Android agent posts inbox records to `POST /v1/device/inbound` with its separate device bearer token. `GET /v1/inbound` returns the last 100 received messages to the normal API client. Inbox data is memory-only in this first deployment and disappears on restart.
