/**
 * Runs before every database test file. `testTimeout` in a Jest `projects`
 * entry is ignored, so it's set here: booting PGlite and applying every
 * migration in `beforeAll` takes about a second alone but can pass Jest's
 * 5-second default when the machine is busy (a parallel `npm run check`, the
 * app project's route tests). Assertions are unchanged; only waiting is longer.
 */
jest.setTimeout(30_000);
