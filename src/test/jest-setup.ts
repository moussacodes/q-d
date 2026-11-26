/**
 * Runs before every app test file. Route tests render whole screens, and the
 * first render of a route loads and transforms its modules. On a busy machine
 * (a parallel `npm run check`, the database project's PGlite suites) that
 * passed React Native Testing Library's 1-second default for `findBy…` and
 * `waitFor`, so a screen that would have appeared failed as "Unable to find".
 * Waiting longer changes no assertion: a screen that never appears still fails.
 */
import { configure } from '@testing-library/react-native';

configure({ asyncUtilTimeout: 5_000 });
