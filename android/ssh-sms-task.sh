#!/data/data/com.termux/files/usr/bin/bash
# Receives the body on stdin, never on argv. Remote lease is permanent and payload-free.
set -euo pipefail
umask 077
mode="${1:?}"; expected_uid="${2:?}"; expected_model="${3:?}"
[[ "$(id -u)" = "$expected_uid" && "$(getprop ro.product.model)" = "$expected_model" ]] || exit 20
if [[ "$mode" = probe ]]; then
    exec timeout 15 termux-sms-list --message-type=sent --message-limit=0
fi
[[ "$mode" = send ]] || exit 21
IFS= read -r task_id
IFS= read -r recipient
IFS= read -r expires
[[ "$task_id" =~ ^[a-f0-9-]{36}$ && "$recipient" =~ ^\+[1-9][0-9]{7,14}$ && "$expires" =~ ^[0-9]+$ ]] || exit 22
[[ "$(date +%s)000" -lt "$expires" ]] || exit 23
state="$HOME/.local/state/android-sms-gateway"
mkdir -p "$state"
# mkdir is an atomic, durable no-second-send lease, including gateway restarts.
mkdir "$state/$task_id" 2>/dev/null || exit 24
printf 'attempted\n' > "$state/$task_id/status"
sync
payload="$(mktemp "$state/$task_id/payload.XXXXXX")"
trap 'rm -f "$payload"' EXIT
cat > "$payload"
started="$(date +%s)000"
timeout 20 termux-sms-send -n "$recipient" < "$payload" > /dev/null 2>&1 || exit 25
# Android sent-store is evidence of submission, not recipient/carrier delivery.
# Only repeat the readback, never the send, while Android commits its sent row.
receipt='[]'
for attempt in 1 2 3; do
    sleep 2
    receipt="$(timeout 8 termux-sms-list --message-type=sent --message-limit=10 \
        --message-selection="type == 2 and date >= $started and replace(address, '+', '') == '${recipient#+}'")"
    [[ "${receipt//[[:space:]]/}" = '[]' ]] || break
done
printf '{"timezone":"%s","messages":' "$(date +%z)"
printf '%s' "$receipt"
printf '}\n'
