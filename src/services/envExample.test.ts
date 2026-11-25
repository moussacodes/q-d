import { envNames } from './env';

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

  it('lists exactly the variables env.ts validates', () => {
    const names = lines.map((line) => line.slice(0, -1));
    expect(names.sort()).toEqual(Object.values(envNames).sort());
  });

  it('never names a server secret as a public variable', () => {
    for (const name of Object.values(envNames)) {
      expect(name.startsWith('EXPO_PUBLIC_')).toBe(true);
      expect(name).not.toMatch(/SECRET|SERVICE_ROLE|PRIVATE|PASSWORD/);
    }
  });
});
