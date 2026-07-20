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
