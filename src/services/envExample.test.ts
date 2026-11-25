import { envNames } from './env';

// Demo account reset (supabase/scripts/reset-demo-accounts.js).
const operatorNames = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'QD_DEMO_USER_IDS',
  'QD_DEMO_EMAILS',
];

const fs = jest.requireActual<{ readFileSync(path: string, encoding: 'utf8'): string }>('fs');

// Jest runs from the repository root.
const lines = fs
  .readFileSync(`${process.cwd()}/.env.example`, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'));

describe('.env.example', () => {
  it('lists names only, with no values', () => {
    for (const line of lines) {
      expect(line).toMatch(/^[A-Z][A-Z0-9_]*=$/);
    }
  });

  it('lists exactly the variables env.ts validates as the public ones', () => {
    const names = lines
      .map((line) => line.slice(0, -1))
      .filter((name) => name.startsWith('EXPO_PUBLIC_'));
    expect(names.sort()).toEqual(Object.values(envNames).sort());
  });

  // Operator-only sections (appended by the server cards) are read by scripts
  // or Supabase, never by the app, so they must never carry the public prefix.
  it('keeps every other variable to the known operator sections', () => {
    const others = lines
      .map((line) => line.slice(0, -1))
      .filter((name) => !name.startsWith('EXPO_PUBLIC_'));
    expect(others.filter((name) => !operatorNames.includes(name))).toEqual([]);
  });

  it('never names a server secret as a public variable', () => {
    for (const name of Object.values(envNames)) {
      expect(name.startsWith('EXPO_PUBLIC_')).toBe(true);
      expect(name).not.toMatch(/SECRET|SERVICE_ROLE|PRIVATE|PASSWORD/);
    }
  });
});
