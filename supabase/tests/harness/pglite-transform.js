/*
 * Jest runs test code inside a Node `vm` context, where `import()` throws unless
 * Node runs with --experimental-vm-modules. PGlite's CommonJS build loads a few
 * Node built-ins (fs, zlib, util, node:module, stream) with `await import("…")`.
 * This transform rewrites those calls to `require`, so the database tests run
 * under plain `npm test` without changing how the app tests run.
 */
const { createHash } = require('node:crypto');

const DYNAMIC_IMPORT = /\bimport\((["'])((?:node:)?[a-z/_]+)\1\)/g;

module.exports = {
  process(source) {
    // Emscripten code declares its own `var require`, so keep a private alias.
    const code = source.replace(DYNAMIC_IMPORT, 'Promise.resolve(__qdRequire($1$2$1))');
    return { code: `const __qdRequire = require;\n${code}` };
  },
  getCacheKey(source, filename) {
    return createHash('sha256')
      .update('pglite-transform-v2')
      .update(filename)
      .update(source)
      .digest('hex');
  },
};
