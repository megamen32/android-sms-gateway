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
