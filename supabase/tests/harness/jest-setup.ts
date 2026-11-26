// PGlite takes a few seconds to start and migrate, and longer while every
// suite runs at once. Jest reads `testTimeout` only from the top-level
// config, not per project, so the db project sets it here.
jest.setTimeout(30_000);
