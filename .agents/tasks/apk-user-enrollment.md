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

e2dfa43 sourcepublished then installed03:59:45MSK/PID1086906. Verified protected
UserIObinding dummyGET200/registeredfalse, exact native47dda/f18a receipts still
sent, nativequeue4sent/1expired; live nativehistory after22 returned200/11.21s,
snapshot22/next22/new0/pending[]. APK unchanged, phone/SMS/calls0. Found stale
gateway USERIO_API_TOKEN causing401; refreshed ONLYthatprotectedslot from current
canonicalUserIOservicecredential. Preserved600private environment/database
rollback under .tmp/apk-user-enroll; no token/key values logged or published.
Root owned fix of firstphone registration ordering before authoritative enroll.

Delta failure shield: five old callbacks failing every15s could starve newerusers
with ORDERreceived and3sticking. RED got fixture0 again instead of fixture5.
Two-line maintainedSQLfix records initial due time and selects ORDERretry_at,
received: fresh ready rows proceed, and recovered older due retries retain order.
Standalone focusedunit1PASS3.71s; no physical/provider action. Expanded threecase
run exceeded30s outerbudget/no summary and is explicitly NOTGREEN; prior22PASS
and two-user19.18s results remain retained. No broad suite/replay is requested.
Root finalwebsitecanary has frozen gateway e2/PID1086906. Delta sourcepublish may
finish independently; install/restart only after Root captureFINISH, followed by
owned metadata/receipt checks. Root optionalfakeincoming skip avoids extrahistory;
normal webenrollment plus exactscopedping suffice for the current onboardingclaim.

Delivery dependency: root's protected bindingGET/setup must be installed before
gatewayenroll live path. Sourcepublish first; then onlygateway scopedrestart with
acceptednativequeue/receipts preserved, protectedtwo-user fakehandshake/readback,
no physicalAPK install/SMS. Parent owns customer web acceptance.

Final acceptance: normal authenticated nonowner UserIO setup returned201 for its
own phone account. Public scoped APK protocol hello returned registeredtrue;
one durable ping552bc707-cca8-47ca-a5c2-602c91f5b25e claimed only its own alias,
resultok and normal user account readback confirmed ownership. No synthetic
incoming message, SMS, call or physical phone operation was performed.

Fairness source703c125 published then installed04:35:59MSK, PID1440149,
NRestarts0. Protected before/after receipts prove exact binding/token hash
preservation and valid existing scoped key; native queue remains4sent/1expired,
both earlier47dda/f18a receipts remain sent. APK1.1/code2 stays unchanged.

Parent's actual headed website acceptance on UserIO34c/gateway703 completed:
public rooted/unrooted SMS guide, advanced calls instructions and APK download;
normal nonowner login, same own phone form, masked token/server success, normal
Disconnect/confirmation, then no remaining connections. Only the QA account was
removed; owner login restored with13 accounts, own browser closed and temporary
remote credential/image copies removed. Existing native S21 and voice unchanged.

Final protected binding GET200 returns registeredfalse/readfalse/replyfalse;
normal user account readback confirms fixture account absent. Old context key
receives tasks401 because website rotated that key before disconnect; this is
token revocation evidence, independently of authoritative account disablement.
No new key was minted for a second live probe; deleted-binding403 is covered by
focused tests. Original ping remainsok; old native receipts remain sent and
native22 history/continuous-sync proof is preserved. QA user remains for parent
ownership. Evidence: ignored protected .tmp/apk-user-enroll/qa-live-protocol-intent.json,
before-fairness-install.json, after-fairness-install.json, qa-after-web-remove.json.
Consumer acceptance and cleanup complete; this post-canary publication changes
only tracker/code map, with runtime703/PID1440149 retained and no further restart.
