# Полная история native SMS

Owning line: android_sms_gateway; UserIO projection/store/runtime remain with
the parent. Canonical source main, no new checkout/branch. Rooted S21 identity
SM-G998B/R5CR702SRFP and Termux:API0.53.0 freshly verified under shared lease.
No new SMS/call, APK, SIP, models or AutoFind change is authorized or performed.

RED consumer: /v1/inbound returned0rows, memory-only; /v1/history404. Direct
supported native provider read returned20real rows,15inbox/5sent, IDs1..20.
Private evidence `.tmp/native-history/provider-first-page.json`0600 under0700
directory; phone numbers/message bodies are not published in logs/repository.

Fix: authenticated /v1/history using existing native helper, typed keyset cursor
and fixed snapshotID, page size1..100, native providerID/direction/date/address/
optional name/read flag. No marks-read and no worker. Optional receipt hydration
requires unique exact recipient/body/fresh date in a complete native snapshot
and sent queue; ambiguous repeated bodies keep separate IDs and no mapping.
Only metadata providerID↔durable receiptID is persisted; send path unchanged.

GSM2SIP capability verified in current pinnedaa5e144 + patches: SmsStore pending
queue200 removes2xx-accepted incoming; SmsOutbox200 prunes finalReported/24h;
CallLogStore500 mixed traffic archive. Actual phone archive298mixed/16SMS
(15IN/1OUT), while system store20SMS(15IN/5OUT). SIP MESSAGE incoming and send/
delivery callbacks exist; no READ_SMS provider query or remote archive query in
that pinned code. Native history endpoint therefore backfills the fuller store.

Fast unit/API expected3s,max20s:15PASS2.19s; red uniquely exposed absent receipt
hydration. Focused delta validates durable mapping plus rejection of changed
date after mapping. Existing no-replay/uncertain/expiry/health/APK checks retain
their results. bash syntax and Bun build succeed. Native read integration expected
15s,max60s uses the existing128/256MiB service RAM,swap0,oneCPU,64tasks,IOWeight10.
Host available42GiB/disk228GiB; no heavy build or extra daemon is required.

Source publish then install helper/runtime, actual authenticated all20read,
bounded paging/no-duplicates, incrementalempty/readflags and accepted47dda
receipt mapping are the remaining integration checks. Root imports under native
account and owns UserIO exact identity hydration; incoming push is not replayed.

DELIVERED09fbbb5: scoped sourcepush preceded phonehelper/runtime installation.
Phonehelper exactly matched previouspublishedscript before atomic upgrade;
senderlogic preserved. Only android-sms-gateway restarted after proving no
queued/sendingtasks. Actual authenticated /v1/history firstpage200 took9.6s,
returnedall20nativeSMS15incoming/5outgoing, snapshot20/next20/has_morefalse;
providerID/body/address/read vectors exactly matcheddirectphone20rowbaseline.
Unique fullsnapshot mappings persisted: provider8→64b2b368 receipt,
provider10→e43a9a52 receipt, provider20→47dda0c0 acceptedownerreceipt. Existing
message identities are hydrated; repeated realtext is never deduplicated.

Consumer paging24.5s: pages7/7/6, cursors0→7→14→20, all20IDs exactlyonce;
nextincremental after20 returned0rows/new snapshot20. Directphysicalprovider
read after APIproof still20rows/15inbox/5sent, readflagsunchanged. Existingqueue
remains3sent/1expired and no pending/sendingtasks: no newSMS/call or oldreplay.
Service21.1MiB/6tasks/NRestarts0, high/max/OOMevents0. Lease084bf70… released,
statusfree. Protectedproofs: .tmp/native-history/gateway-full.json,
paging-proof.json, provider-first-page.json; no rawsensitivepublicoutputs.

Root received READY API/schema/proof, including required35sclienttimeout
(generic8s is insufficient for coldfirstpage), exactreceipt20 mapping and
GSM2SIP archive capability/count. UserIOimport/UI/accountprojection remains
parent-owned; that final usersurface claim is not made by this gateway line.

Continuous-sync audit: source/runtime925ba85, PID181937, authenticated after20
returned200/9.26s, snapshot20/no new rows; accepted47dda remains sent. No newly
arriving SMS has been sent or observed in this audit. No replay or UI action.
Confirmed failure shield: Android outbox4/queued6 can mutate to sent2 at the same
providerID after a later inbox row moves the cursor. Original transport regression
was RED for both outbox and queued; pending rows were misprojected as outgoing
and forgotten. Root rejected a blocking barrier because it can starve incoming.
Settled contract: bounded pending_ids CSV request/list response, independent
new-page watermark, merged completed pending rows, no new worker/daemon. Cases
cover late sent21 after inbox22, long pending across >100 new rows, deleted
pending, fresh retry after transport failure and refusal of foreign pending IDs.

Second confirmed cause: productionjournal03:10:47 reports Bun request timed out
after10seconds, matching UserIO RemoteDisconnected. /v1/history now uses the
official Bun server.timeout(request,75), preserving other route deadlines.
Native snapshot20s + page/pending40s, client65s. Focused HTTP regression delays
the provider11seconds through a test-only SSH PATH and expects a real HTTP200;
no physical phone, sender or production route is altered by the test.
Fast unit expected3s/max20s:14PASS2.24s including no-replay/expiry guards.
Focused integration expected12s/max25s, sourcepublish/install and live read proof
are required before claiming continuous source readiness. Parent owns UserIO
durable pending/cursor polling and its real consumer acceptance.

DELIVERED254599b published main before dependent install. Existing phone helper
matched runtime925ba85 byte-for-byte; atomically replaced with published helper,
sender unchanged. Runtime ff installed254599b and scoped gateway restart03:19:45
MSK/PID688728; no UserIO source/runtime changes. Native queue3sent/1expired before
canary. Source code/HTTP tests16PASS total14.42s, build and shell syntax PASS.
Live after20,pending20 returned old settled20/47dda with200 in13.47s (past the
former10s HTTP cutoff), then after20 empty and complete20rows both returned200.
Protected continuous-proof.json records metadata; complete private native page
gateway-continuous-full.json is0600. No frozen cache or source/helper drift.

Parent authorized ONEnew selfSMS after all source/install/restart checks finished.
Own SIM provenance: exact accepted47dda body in Mac incoming SMSrow10288, sender
handle plus11digits ending0755; protected own-sim-provenance.json. Fresh guarded
phone identity SM-G998B/R5CR702SRFP, native baseline20, queue3sent/1expired.
Durable0600 continuous-self-sms-intent.json existed before single authenticated
POST/v1/messages with unique idempotency/body; pre-attempt flag persisted.
Receiptf18a3f3d-f077-45c1-9a1a-62896c885d6c202→sent/android_sent_store. No repeat,
no old47dda replay, no source/runtime changes until readback capture completed.
Fresh historyafter20 returned200/9.47s, snapshot22/next22/pending[]; exact newbody
and ownrecipient match two real provider rows21sent/outgoing +22inbox/incoming.
Body SHA256ea3968644e9229a913634fc496f83c3ad7b54c6e41458b8f4961501e4d487202.
Native inbox22 independently proves receipt on the phone; gateway deliveryflag
remainsfalse because its sent-receipt API only promises submission.
Private continuous-self-sms-native-readback.json/intent state preserve result.
Leaseab3f96… releasedFREE, gatewayPID688728/NRestarts0/~31.5MiB/5tasks. Parent
checks new21/22 through ordinary UserIOdaemon (no manual poll/reset/import);
final UserIOsurface is parent-owned. No further SMS/call is planned or replayed.
