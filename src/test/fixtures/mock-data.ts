/**
 * The sample data now lives with the mock adapters in src/providers/mock/data.ts.
 * This re-export keeps tests and the screens still on the known-exception list
 * in eslint.config.js working until each screen moves to a feature hook.
 */
export * from '@/providers/mock/data';
