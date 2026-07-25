#!/usr/bin/env node
// Runs both .maestro/*.yaml flows against a running simulator/emulator +
// Expo Go session and drops screenshots into a timestamped folder under
// /mobile/screenshots, so a full client-facing batch is one command instead
// of a manual walkthrough. See /mobile/.maestro/README.md for prerequisites
// (Maestro CLI, a booted device with the app already open, env vars below).
//
// Plain Node (not a .sh/.ps1 script) so this runs the same way on the
// Windows dev machine this was built on and on a teammate's Mac/Linux box.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const MOBILE_ROOT = path.resolve(__dirname, '..');
const MAESTRO_DIR = path.join(MOBILE_ROOT, '.maestro');
const SCREENSHOTS_ROOT = path.join(MOBILE_ROOT, 'screenshots');

// name -> [flow file, expected screenshot count]. Expected counts are the
// number of `takeScreenshot:` lines in each flow as of this writing — used
// only to report "N of M captured" per CLAUDE.md's spirit of flagging gaps
// rather than silently declaring success; update if a flow file changes.
const FLOWS = {
  staff: { file: 'staff-flow.yaml', expected: 6 },
  admin: { file: 'admin-flow.yaml', expected: 7 },
};

const REQUIRED_ENV = ['MAESTRO_APP_ID', 'STAFF_TEST_PHONE', 'ADMIN_TEST_PHONE', 'STAFF_TEST_CUSTOMER_PHONE'];

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function checkMaestroInstalled() {
  const result = spawnSync('maestro', ['--version'], { encoding: 'utf8', shell: true });
  if (result.error || result.status !== 0) {
    fail(
      'Maestro CLI not found on PATH. Install it first — see /mobile/.maestro/README.md ' +
        '(the install command changes periodically; check https://docs.maestro.dev for the current one).'
    );
  }
}

function checkEnv() {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    fail(
      `Missing required env var(s): ${missing.join(', ')}.\n` +
        'Set these before running (see /mobile/.maestro/README.md for what each one needs to be):\n' +
        REQUIRED_ENV.map((k) => `  ${k}=...`).join('\n')
    );
  }
  if (!process.env.MOCK_OTP) {
    process.env.MOCK_OTP = '123456'; // backend's fixed MOCK_AUTH code — safe default, not a secret
    console.log('MOCK_OTP not set — defaulting to 123456 (the backend\'s fixed MOCK_AUTH code).');
  }
}

function timestampedDir() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19); // e.g. 2026-07-25T14-30-05
  const dir = path.join(SCREENSHOTS_ROOT, stamp);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function runFlow(name, { file, expected }, outDir) {
  const flowPath = path.join(MAESTRO_DIR, file);
  const roleDir = path.join(outDir, name);
  fs.mkdirSync(roleDir, { recursive: true });

  console.log(`\n--- Running ${name} flow (${file}) ---`);
  const result = spawnSync('maestro', ['test', flowPath], {
    cwd: roleDir, // takeScreenshot writes relative to CWD
    env: process.env,
    stdio: 'inherit',
    shell: true,
  });

  const captured = fs.existsSync(roleDir) ? fs.readdirSync(roleDir).filter((f) => f.endsWith('.png')) : [];
  const ok = result.status === 0;
  console.log(`${ok ? '✓' : '✗'} ${name}: ${captured.length} of ${expected} expected screenshots captured in ${roleDir}`);
  if (!ok) {
    console.log(`  (maestro exited with status ${result.status} — the flow likely failed partway through; see output above)`);
  }
  return { name, ok, captured: captured.length, expected };
}

function main() {
  checkMaestroInstalled();
  checkEnv();

  const outDir = timestampedDir();
  console.log(`Output folder: ${outDir}`);

  const results = Object.entries(FLOWS).map(([name, flow]) => runFlow(name, flow, outDir));

  console.log('\n=== Summary ===');
  let totalCaptured = 0;
  let totalExpected = 0;
  for (const r of results) {
    totalCaptured += r.captured;
    totalExpected += r.expected;
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}: ${r.captured}/${r.expected}`);
  }
  console.log(`Total: ${totalCaptured}/${totalExpected} screenshots in ${outDir}`);

  if (results.some((r) => !r.ok) || totalCaptured < totalExpected) {
    process.exitCode = 1;
  }
}

main();
