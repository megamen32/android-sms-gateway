# Own phone to own UserIO account

Gateway owner only: server/AgentQueue/auth/callback/tests/API documentation.
Root owns UserIO authenticated setup API, binding GET, account/route/store/UI,
and consumer browser proof. Shared checkout main; APK/native S21/voice untouched.
No physical phone control/install or new SMS is part of this slice.

Verified old runtime254599b/PID688728: /agent/* requires one shared device token,
caller freely supplies device_id, hello registers into service principal's owner
account. PublicAPK20032644B SHA343cc17afa8efd9fde9b1ec020bced9ef9a0fea302b6268f2357d10c974c1c3c
matches installed artifact; binarymanifest com.userio.smsagent1.1/code2.
APK already has URL/token/visible physicalID: no rebuild required for enrollment.
Source limits: SMS only, best-effort newincoming upload, no old archive/offline
phone upload retry; /agent/inbound formerly rejected short/named senders.

Settled root contract: opaque perdevice token hash in existing AgentQueueDB,
scope alias user-sha256(user_id)[:16]-physicalID, account sms:alias. Internal
POST/v1/agent/enroll validates exactaccount via existing UserIO service auth at
GET/v1/sms/agent-binding. Same user/phone rotation preserves queue/account.
Agent payloads retain physicalID, server authenticates then operates scopedalias.
Legacy masterdevice path cannot claim an enrolled alias; enrolledhello never
registers an owner account. Claims/read require current registered permissions;
already dispatched result receipts survive account disablement. No fallback.

Incoming callback persists in existingDB before ack, bounded one existingprocess
tick, stableid normal POST/v1/messages, retry15s only callback, neverSMS. The
normal UserIO ingress_user lookup owns target identity. Root cookie derives user
and owns account/route; no global gateway/UserIO key goes onto customerphones.

RED: same two-user HTTP regression run against current /opt source returned
not_found for enrollment before changes. New scoped phone-token test passes
same physicalID/two tenant isolation; callback temporary503 retries same ID and
account; disabled/missingbinding denies without ownerregistration. DB test proves
rawtoken absent, sameuserrotation, durablebinding/incoming across restart.
Focused integration expected20s/max25s, native/legacy unit expected4s/max15s,
history11s idle HTTP expected12s/max18s. Ordinary allchecks max50s, hard180s.
Existing API tests were repaired to use free ephemeral ports and bounded3s
startup instead of random applicationports/1s; initial combinedcheck exposed a
local port/startup failure, not a phone/provider action. Final GREEN still required.

Final combined22PASS39.15s/max50s and Bunbuild PASS; focused delta2PASS19.18s
adds binding-endpoint503 denial and falsehello without ownerregistration. No
external device, SMS, root account, credential or runtime mutation in tests.
Exactsource inputs reviewed; APKsource/binary unchanged. Ready for scopedpublish
and installation once root's protected bindingGET is verified live.

Delivery dependency: root's protected bindingGET/setup must be installed before
gatewayenroll live path. Sourcepublish first; then onlygateway scopedrestart with
acceptednativequeue/receipts preserved, protectedtwo-user fakehandshake/readback,
no physicalAPK install/SMS. Parent owns customer web acceptance.
