# Automated screenshot capture (Maestro)

`npm run screenshots` (from `/mobile`) runs `staff-flow.yaml` and
`admin-flow.yaml` against a running simulator/emulator and drops a full,
sequentially-named batch of screenshots into a new timestamped folder under
`/mobile/screenshots/` — so regenerating client-facing screenshots after a UI
change is one command instead of a manual walkthrough.

## Real prerequisite this app doesn't have yet: no native build

This project currently runs **inside Expo Go** (`mobile/README.md`'s own
setup instructions: "Scan the QR code with Expo Go... no Android
Studio/Xcode install required"). `app.json` has no `android.package` or
`ios.bundleIdentifier` set, which means there is no standalone installable
app with its own package/bundle id yet — `npx expo prebuild` / an EAS build
has never been run for this project.

Maestro automates **installed native apps**, identified by `appId`
(package name on Android, bundle id on iOS). It cannot drive a web build —
`expo start --web` is not a Maestro target at all, native UI automation
only. Two ways to give it something to target:

- **Lower-friction (recommended first)**: target Expo Go itself
  (`appId: host.exp.exponent` on Android) and deep-link straight into this
  project instead of navigating Expo Go's own "recent projects" UI —
  `- openLink: exp://<your-dev-machine-LAN-IP>:8081` as the first step
  after `launchApp`. No native build needed, works with the exact `expo
  start` workflow this project already uses.
- **More robust for CI / repeat runs**: set `android.package` /
  `ios.bundleIdentifier` in `app.json` (a real product decision — this also
  becomes the permanent app-store identifier, so don't pick it silently;
  confirm with whoever owns that call) and build a dev client
  (`npx expo run:android` / `run:ios`, or an EAS dev build). Then `appId`
  is that real package/bundle id and `launchApp` alone is enough — no
  Expo Go deep-link step.

Either way, check <https://docs.maestro.dev> for the current install command
before running it — the flow's own comment in the original request already
flagged this changes periodically, confirmed true while writing this (the
docs site's install page returned a 404 during this pass; use the
site's search/sitemap if the link below has moved).

```
curl -Ls "https://get.maestro.mobile.dev" | bash
```

## Required environment variables

| Variable | What it needs to be |
|---|---|
| `MAESTRO_APP_ID` | `host.exp.exponent` (Expo Go path) or your configured native package/bundle id |
| `STAFF_TEST_PHONE` | A **real, DB-registered** `role: 'staff'` phone number (10 digits, no `+91`) |
| `ADMIN_TEST_PHONE` | A **real, DB-registered** `role: 'admin'` phone number |
| `STAFF_TEST_CUSTOMER_PHONE` | A phone number used to search/create a test customer inside New Order Entry |
| `MOCK_OTP` | Optional, defaults to `123456` |

The login screen has no Admin/Staff toggle — role always comes from the
looked-up `users` row, same for MOCK_AUTH and real auth (see repo-root
`CLAUDE.md`'s "Mobile testing fixes" section). This means, unlike an
earlier version of this flow, **`STAFF_TEST_PHONE`/`ADMIN_TEST_PHONE` must
be real phone numbers already seeded in the target database** with the
matching role — an unregistered number 404s here exactly like it would in
production. With `MOCK_AUTH` on, the only thing that's faked is OTP
delivery: the code is always the fixed `123456` instead of a real Twilio
send, so you don't need a working OTP path to run this — you do still need
at least one real staff account and one real admin account to log in as.
If no staff account exists yet in your target DB, create one first via the
admin Staff tab (`StaffManagementScreen.tsx` → "+ Add Staff / Admin").

If you instead want to test against real (non-mock) auth, the same two
numbers need to be able to actually receive a real OTP, and `MOCK_OTP`
doesn't apply.

## Data side effect — read before running

`staff-flow.yaml` searches for, and if not found creates, a customer named
**"Maestro Screenshot Test"** at `STAFF_TEST_CUSTOMER_PHONE` so the garment
picker has something to unlock (CLAUDE.md's customer-first New Order Entry
flow). MOCK_AUTH only fakes the auth layer — customer creation hits the
real database. This is a real row in the live `customers` table, tagged
with that name specifically so it's easy to find and delete afterward. The
flow deliberately stops before "Confirm Pickup", so it never creates a real
order. `admin-flow.yaml` is read-only (tab navigation only) — no data
side effects there.

## Running it

1. Boot a simulator/emulator (or connect a device) with Expo Go installed
   and this project's dev server already running (`npx expo start`).
2. Set the env vars above.
3. `npm run screenshots` from `/mobile`.

Output lands in `/mobile/screenshots/<timestamp>/staff/` and
`/mobile/screenshots/<timestamp>/admin/`, numbered so they sort in viewing
order (`01_login_staff.png`, `02_staff_home.png`, ...). The script prints a
summary of how many screenshots were actually captured vs. how many each
flow defines, so a partial failure is visible rather than silent.

## Status as of this writing

Built and reviewed against the actual current screen code (testIDs added to
`LoginScreen.tsx` and `NewOrderEntryScreen.tsx` specifically to support
this), but **not run end-to-end** — this was written in a Windows
environment with no Java runtime, no Android SDK/emulator, and no `adb`
(all confirmed absent, not assumed), and iOS simulators don't run on
Windows at all. There was nothing to launch Maestro against here. Needs a
real run against a booted simulator/emulator (your machine, a teammate's
Mac, or CI) to confirm the selectors and conditional branches actually hold
up — flag anything that doesn't match so the flow files can be corrected.
