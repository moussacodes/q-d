/**
 * What app.config.ts asks of iOS builds. There's no ios/ folder (AGENTS.md),
 * so these settings are the only record of the capabilities a build gets.
 */
import appConfig from '../app.config';

const pluginNames = (appConfig.plugins ?? []).map((plugin) =>
  Array.isArray(plugin) ? plugin[0] : plugin,
);

describe('Sign in with Apple', () => {
  it('turns on the capability for builds', () => {
    expect(appConfig.ios?.usesAppleSignIn).toBe(true);
  });

  it('adds the expo-apple-authentication config plugin', () => {
    expect(pluginNames).toContain('expo-apple-authentication');
  });

  it('keeps the bundle ID the Supabase Apple provider lists as a client ID', () => {
    expect(appConfig.ios?.bundleIdentifier).toBe('app.qd.mobile');
  });
});
