// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier/flat');

/*
 * Import boundaries from docs/ARCHITECTURE.md §4 ("Import rules").
 * Cross-folder imports use the `@/` alias, so the rules match `@/<folder>`, plus
 * relative paths that climb into app/.
 * Not enforced: one feature importing another feature's internals.
 */
const RULES_DOC = 'See docs/ARCHITECTURE.md §4, "Import rules".';

const noSrc = (folders, why) => ({
  regex: `^@/(${folders.join('|')})(/|$)`,
  message: `${why} ${RULES_DOC}`,
});
const noApp = {
  regex: '^(\\.\\./)+app(/|$)',
  message: `Nothing under src/ imports app/. ${RULES_DOC}`,
};
const noTestCode = {
  regex: '^@/test(/|$)',
  message: `src/test is for tests; production code must not import it. ${RULES_DOC}`,
};

const layers = [
  {
    files: ['app/**'],
    patterns: [
      noSrc(
        ['services', 'providers'],
        'Screens reach services and providers through a feature hook.',
      ),
    ],
  },
  {
    files: ['src/features/**'],
    patterns: [noApp],
  },
  {
    files: ['src/components/**'],
    patterns: [
      noSrc(['features', 'services', 'providers'], 'Components are presentational.'),
      noApp,
    ],
  },
  {
    files: ['src/design/**'],
    patterns: [
      noSrc(
        ['components', 'domain', 'features', 'providers', 'services'],
        'Design tokens depend on nothing else in src/.',
      ),
      noApp,
    ],
  },
  {
    files: ['src/domain/**'],
    patterns: [
      noSrc(['components', 'design', 'features', 'providers', 'services'], 'Domain code is pure.'),
      {
        regex: '^(react|react-native|expo|expo-.+|@expo/.+|@supabase/.+)$',
        message: `Domain code is pure TypeScript: no React, React Native, Expo or Supabase. ${RULES_DOC}`,
      },
      noApp,
    ],
  },
  {
    files: ['src/providers/**'],
    patterns: [
      noSrc(['features', 'components'], 'Providers sit below features and components.'),
      noApp,
    ],
  },
  {
    files: ['src/services/**'],
    patterns: [
      noSrc(['features', 'components', 'providers'], 'Services sit below everything but domain.'),
      noApp,
    ],
  },
];

/*
 * Known exception (docs/ARCHITECTURE.md §4): these screen shells read sample
 * data from src/test/fixtures until the mock-data development mode replaces it.
 * Remove a file from this list when it stops importing src/test. Don't add new ones.
 */
const mockDataImporters = ['app/onboarding/name.tsx', 'app/room/[[]code]/invite.tsx'];

const testFiles = ['**/*.test.ts', '**/*.test.tsx', '__tests__/**', 'src/test/**'];

const restrict = (patterns) => ({ 'no-restricted-imports': ['error', { patterns }] });

const boundaries = layers.flatMap(({ files, patterns }) => {
  // 'app/**' → 'app/'
  const exceptions = mockDataImporters.filter((file) =>
    files.some((glob) => file.startsWith(glob.slice(0, -2))),
  );
  return [
    { files, ignores: [...testFiles, ...exceptions], rules: restrict([...patterns, noTestCode]) },
    ...(exceptions.length > 0 ? [{ files: exceptions, rules: restrict(patterns) }] : []),
  ];
});

module.exports = defineConfig([
  expoConfig,
  // Formatting is Prettier's job; this turns off ESLint rules that would fight it.
  prettierConfig,
  ...boundaries,
  {
    ignores: ['dist/*', 'web-build/*', '.expo/*', 'expo-env.d.ts', 'coverage/*'],
  },
]);
