#!/data/data/com.termux/files/usr/bin/bash
set -eu

: "${GATEWAY_URL:?Set GATEWAY_URL to the HTTPS gateway URL}"
: "${DEVICE_TOKEN:?Set DEVICE_TOKEN to the device bearer token}"

while true; do
  payload="$(termux-sms-list -d -n -t inbox -l 100)"
  curl --fail --silent --show-error --max-time 20 \
    -H "Authorization: Bearer ${DEVICE_TOKEN}" \
    -H 'Content-Type: application/json' \
    --data "{\"messages\":${payload}}" \
    "${GATEWAY_URL%/}/v1/device/inbound" || true
  sleep 20
done
