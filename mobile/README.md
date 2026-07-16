# Peach & Blue — Mobile

React Native app (Expo, managed workflow), single codebase with role-gated Staff and Admin views. See `.claude/CLAUDE.md` and `/docs` at the repo root for product/architecture context, and `docs/PeachBlue_App_Screens_Mockup.html` for the screen designs this was built against.

## Setup

```
npm install
cp .env.example .env   # point EXPO_PUBLIC_API_URL at your running backend
npx expo start
```

Scan the QR code with Expo Go (Android) or the Camera app (iOS) to run on a physical device — no Android Studio/Xcode install required for day-to-day development.

## Environment variables

- `EXPO_PUBLIC_API_URL` — base URL of the backend API (`/` at repo root). For a physical device, use your machine's LAN IP instead of `localhost` — the device can't resolve your dev machine's `localhost` as itself.

## Push notifications (FCM via Expo's push service)

Push uses `expo-notifications`, which relays through Expo's push service (backed by FCM on Android, APNs on iOS) rather than linking the raw Firebase SDK directly. This requires an EAS project id, which this app does **not** have configured yet:

1. `npx eas init` (creates/links an EAS project, writes `extra.eas.projectId` into `app.json`) — an account-level step, do this once.
2. After that, `registerForPushNotifications()` (`src/services/pushNotifications.ts`) will actually be able to fetch a push token. Until then, it fails silently (caught in `App.tsx`) rather than crashing the app.

## Scripts

- `npx expo start` — start the dev server (scan the QR with Expo Go).
- `npx tsc --noEmit` — typecheck.
- `npx expo export --platform android` — verify the app bundles without a device/simulator.
