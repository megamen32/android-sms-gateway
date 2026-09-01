# Android SMS Gateway

[Русский](docs/README.ru.md) · [API](docs/API.md)

![Android SMS Gateway](docs/hero.svg)

> A small, authenticated verification API that sends through one Android phone connected over ADB and Termux:API.

- Server-generated six-digit verification codes
- Authenticated text delivery for trusted integrations (for example, an approved UserIO draft)
- Android presence endpoint and accepted-by-Android status
- Multiple ADB devices with an explicit per-send `device_serial` choice
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
3. Connect the Android via ADB, set the two environment variables, and start the server.

For inbound SMS, install `curl` in Termux, copy `android/inbound-agent.sh` to the phone, set `GATEWAY_URL` and `DEVICE_TOKEN`, then run it in Termux or Termux:Boot.

The server listens on `127.0.0.1:8787` by default. Put it behind HTTPS and keep the bearer key server-side.

`POST /v1/messages` lets a trusted bearer-token client send one text SMS through the Android device. It has the same rate limits as verification SMS and returns only `accepted_by_android`, never a carrier-delivery claim.

For an always-on local service, install [`deploy/android-sms-gateway.service`](deploy/android-sms-gateway.service), copy [`deploy/android-sms-gateway.env.example`](deploy/android-sms-gateway.env.example) to `/etc/android-sms-gateway.env` with mode `0600`, then enable it with systemd. Keep `HOST=127.0.0.1`: UserIO can call it locally without publishing its bearer API.

## Learn more

- [API](docs/API.md)
- [Russian setup](docs/README.ru.md)
