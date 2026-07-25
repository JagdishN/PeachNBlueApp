// config/index.ts now calls dotenv.config({ override: true }) (fixes a
// separate bug: a stale process-level DATABASE_URL inherited from a dev
// server's parent process tree was silently beating the real .env value,
// since plain dotenv.config() never overrides an already-set process.env
// key). That means it would otherwise read this repo's real .env file on
// disk and stomp the process.env values this test deliberately pre-sets
// below — mocked out so the test is fully decoupled from whatever's
// actually on disk, which is what it should have been regardless.
jest.mock('dotenv', () => ({ config: jest.fn() }));

// This repo's local .env has JWT_SECRET='' (present but empty) — getEnv's
// old `??` fallback only catches null/undefined, so it silently resolved to
// '' instead of the documented fallback. Covers the fix in config/index.ts.
describe('config getEnv — empty-string handling', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV, DATABASE_URL: 'postgres://test' };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('falls back to the default when an env var is set but empty, not just when unset', () => {
    process.env.JWT_SECRET = '';

    const { JWT_SECRET } = require('../config');

    expect(JWT_SECRET).toBe('replace-with-secret');
  });

  it('still honors a real, non-empty value', () => {
    process.env.JWT_SECRET = 'a-real-secret';

    const { JWT_SECRET } = require('../config');

    expect(JWT_SECRET).toBe('a-real-secret');
  });
});
