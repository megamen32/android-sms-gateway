# Android SMS Gateway

[Русский](docs/README.ru.md) · [API](docs/API.md)

![Android SMS Gateway](docs/hero.svg)

> A small, authenticated verification API that sends through one Android phone connected over ADB and Termux:API.

- Server-generated six-digit verification codes
- Android presence endpoint and accepted-by-Android status
- Per-number and global rate limits
- No telephone numbers, API keys, or delivery claims stored in the repository

## Install

```bash
SMS_GATEWAY_API_KEY=change-me ANDROID_SERIAL=your-adb-serial bun run start
```

## Start in minutes

1. Install Termux and Termux:API from the same distribution, then install `termux-api` inside Termux.
2. Grant Termux:API the `SEND_SMS` and `READ_PHONE_STATE` permissions.
3. Connect the Android via ADB, set the two environment variables, and start the server.

The server listens on `127.0.0.1:8787` by default. Put it behind HTTPS and keep the bearer key server-side.

## Learn more

- [API](docs/API.md)
- [Russian setup](docs/README.ru.md)
