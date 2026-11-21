#!/usr/bin/env node
/*
 * One Expo dev server for the edits in all your git worktrees.
 *
 * Each worktree's files are snapshotted, merged with git and written into a separate preview
 * worktree next to the main folder (`<main folder>-preview`). A single `expo start` runs
 * there. Snapshots include committed, uncommitted and untracked files, minus .gitignore, and
 * taking one never touches that worktree's index. When you save a file in any of those
 * worktrees, the preview updates within a second and Fast Refresh shows the change.
 *
 * If two worktrees change the same lines of a file, the preview shows that whole file from
 * the worktree with the most recent edit, and the log says which one.
 *
 * Don't edit files inside the preview worktree. Every sync overwrites them.
 */
const { spawn, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const USAGE = `Usage:
  npm run preview                          every worktree except the main folder
  npm run preview -- q-d-ui q-d-logos      only these worktrees (folder name or path)
  npm run preview -- q-d-ui -- --tunnel    anything after a second -- goes to \`expo start\``;

const isWin = process.platform === 'win32';
// Changes under these folders never affect the preview.
const IGNORED_DIRS = new Set(['.git', 'node_modules', '.expo', 'dist', 'web-build', 'coverage']);
// A fixed identity and date make the commits deterministic. A worktree that hasn't changed
// maps to the same commit, so syncing doesn't keep adding new objects.
const COMMIT_ENV = {
  GIT_AUTHOR_NAME: 'preview',
  GIT_AUTHOR_EMAIL: 'preview@localhost',
  GIT_AUTHOR_DATE: '@0 +0000',
  GIT_COMMITTER_NAME: 'preview',
  GIT_COMMITTER_EMAIL: 'preview@localhost',
  GIT_COMMITTER_DATE: '@0 +0000',
};

const args = process.argv.slice(2);
const split = args.indexOf('--');
const names = split === -1 ? args : args.slice(0, split);
const expoArgs = split === -1 ? [] : args.slice(split + 1);
if (names.some((name) => name.startsWith('-'))) {
  console.log(USAGE);
  process.exit(names.includes('--help') || names.includes('-h') ? 0 : 1);
}

function run(gitArgs, { cwd = repoDir, env, input, okStatus = [0] } = {}) {
  const result = spawnSync('git', ['-c', 'core.safecrlf=false', ...gitArgs], {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    input,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (!okStatus.includes(result.status)) {
    throw new Error(`git ${gitArgs.join(' ')} failed in ${cwd}\n${result.stderr.trim()}`);
  }
  return { stdout: result.stdout.replace(/\n$/, ''), status: result.status };
}
const git = (gitArgs, options) => run(gitArgs, options).stdout;
const nulList = (text) => text.split('\0').filter(Boolean);

const norm = (p) => (isWin ? path.resolve(p).toLowerCase() : path.resolve(p));
const samePath = (a, b) => norm(a) === norm(b);

const time = () => new Date().toTimeString().slice(0, 8);
const log = (message) => console.log(`\x1b[36m[preview ${time()}]\x1b[0m ${message}`);
const warn = (message) => console.log(`\x1b[33m[preview ${time()}]\x1b[0m ${message}`);

const repoDir = git(['rev-parse', '--show-toplevel'], { cwd: path.dirname(process.argv[1]) });
const tmpDir = path.join(os.tmpdir(), 'qd-preview');
fs.mkdirSync(tmpDir, { recursive: true });

function listWorktrees() {
  return git(['worktree', 'list', '--porcelain'])
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const entry = { path: '', name: '', skip: false };
      for (const line of block.split('\n')) {
        const [key, ...rest] = line.split(' ');
        if (key === 'worktree') entry.path = path.resolve(rest.join(' '));
        if (key === 'bare' || key === 'prunable') entry.skip = true;
      }
      entry.name = path.basename(entry.path);
      return entry;
    })
    .filter((entry) => !entry.skip);
}

const mainDir = listWorktrees()[0].path;
const previewDir = `${mainDir}-preview`;

function selectWorktrees() {
  const all = listWorktrees().filter((wt) => !samePath(wt.path, previewDir));
  if (names.length === 0) return all.filter((wt) => !samePath(wt.path, mainDir));
  return names.map((name) => {
    const match = all.find(
      (wt) => wt.name.toLowerCase() === name.toLowerCase() || samePath(wt.path, name),
    );
    if (!match) {
      throw new Error(`No worktree called "${name}". Worktrees: ${all.map((wt) => wt.name)}`);
    }
    return match;
  });
}

// Each git call costs about 80 ms on Windows, so a sync makes as few as it can.
const indexPaths = new Map();
// When the watcher last saw a change in each worktree. It decides who wins a conflict.
const editedAt = new Map();

/** Commits the worktree's current files without touching its index or files. */
function snapshot(wt) {
  const key = norm(wt.path);
  const id = crypto.createHash('sha1').update(key).digest('hex').slice(0, 12);
  const env = { GIT_INDEX_FILE: path.join(tmpDir, `${id}.index`) };
  if (!indexPaths.has(key)) {
    const index = git(['rev-parse', '--path-format=absolute', '--git-path', 'index'], {
      cwd: wt.path,
    });
    indexPaths.set(key, index);
  }
  // Starting from a copy of the worktree's own index lets `git add` skip files whose
  // size and modification time haven't changed.
  if (fs.existsSync(indexPaths.get(key))) fs.copyFileSync(indexPaths.get(key), env.GIT_INDEX_FILE);
  else git(['read-tree', 'HEAD'], { cwd: wt.path, env });
  git(['add', '--all'], { cwd: wt.path, env });
  const tree = git(['write-tree'], { cwd: wt.path, env });
  const commit = git(['commit-tree', tree, '-p', 'HEAD', '-m', `preview of ${wt.name}`], {
    cwd: wt.path,
    env: COMMIT_ENV,
  });
  if (!editedAt.has(key)) editedAt.set(key, newestChange(wt, env));
  return { name: wt.name, commit, lastEdit: editedAt.get(key) };
}

/** Before the watcher has seen anything: the newest file that differs from HEAD. */
function newestChange(wt, env) {
  const changed = git(['diff-index', '--cached', '--name-only', '-z', 'HEAD'], {
    cwd: wt.path,
    env,
  });
  let newest = 0;
  for (const file of nulList(changed)) {
    try {
      newest = Math.max(newest, fs.statSync(path.join(wt.path, file)).mtimeMs);
    } catch {
      // Deleted in the worktree.
    }
  }
  return newest;
}

/** Returns `tree` with each of `files` replaced by its version in `commit`. */
function takeFiles(tree, commit, files) {
  const env = { GIT_INDEX_FILE: path.join(tmpDir, 'merge.index'), GIT_LITERAL_PATHSPECS: '1' };
  git(['read-tree', tree], { env });
  const entries = files.map((file) => {
    const [entry] = nulList(git(['ls-tree', '-z', commit, '--', file], { env }));
    if (!entry) return `0 ${'0'.repeat(40)}\t${file}`; // Deleted on that side: remove it.
    const [mode, , oid] = entry.split('\t')[0].split(' ');
    return `${mode} ${oid}\t${file}`;
  });
  git(['update-index', '-z', '--index-info'], { env, input: entries.join('\0') + '\0' });
  return git(['write-tree'], { env });
}

// Commits are deterministic, so a merge of the same two commits always gives the same result.
// The worktree you just saved in sorts last, and every merge before it comes from this cache.
const mergeCache = new Map();

function mergeStep(merged, snap) {
  const key = `${merged} ${snap.commit}`;
  if (mergeCache.has(key)) return mergeCache.get(key);
  const { stdout, status } = run(
    ['merge-tree', '--write-tree', '--name-only', '--no-messages', '-z', merged, snap.commit],
    { okStatus: [0, 1] },
  );
  const [mergedTree, ...conflicted] = nulList(stdout);
  const files = status === 1 ? [...new Set(conflicted)] : [];
  const tree = files.length > 0 ? takeFiles(mergedTree, snap.commit, files) : mergedTree;
  const commit = git(
    ['commit-tree', tree, '-p', merged, '-p', snap.commit, '-m', 'preview merge'],
    {
      env: COMMIT_ENV,
    },
  );
  if (mergeCache.size > 1000) mergeCache.clear();
  mergeCache.set(key, { commit, files });
  return { commit, files };
}

function mergeAll(snaps) {
  // Oldest edit first, so the worktree you saved in last wins any conflicting file.
  const [first, ...rest] = [...snaps].sort((a, b) => a.lastEdit - b.lastEdit);
  let merged = first.commit;
  const conflicts = [];
  for (const snap of rest) {
    const step = mergeStep(merged, snap);
    if (step.files.length > 0) conflicts.push({ winner: snap.name, files: step.files });
    merged = step.commit;
  }
  // One call for both: the tree to show and the package-lock.json it needs.
  const { stdout, status } = run(['rev-parse', `${merged}^{tree}`, `${merged}:package-lock.json`], {
    okStatus: [0, 128],
  });
  const [tree, lockFile] = stdout.split('\n');
  return { tree, lockFile: status === 0 ? lockFile : '', conflicts };
}

function ensurePreviewWorktree() {
  if (listWorktrees().some((wt) => samePath(wt.path, previewDir))) return;
  if (fs.existsSync(previewDir)) {
    throw new Error(`${previewDir} exists but isn't a worktree of this repo. Move it and rerun.`);
  }
  log(`Creating the preview worktree at ${previewDir}`);
  git(['worktree', 'add', '--detach', previewDir, 'HEAD']);
}

const stampFile = () => path.join(previewDir, 'node_modules', '.qd-preview-lock');

function depsInstalled(lockFile) {
  try {
    return fs.readFileSync(stampFile(), 'utf8') === lockFile;
  } catch {
    return false;
  }
}

function installDeps(lockFile) {
  log('Installing packages in the preview worktree (npm ci)…');
  const result = spawnSync('npm ci --no-audit --no-fund', {
    cwd: previewDir,
    stdio: 'inherit',
    shell: true,
  });
  if (result.status !== 0) throw new Error('npm ci failed in the preview worktree.');
  fs.writeFileSync(stampFile(), lockFile);
}

let expo = null;
let shuttingDown = false;

function startExpo() {
  const cli = path.join(previewDir, 'node_modules', 'expo', 'bin', 'cli');
  expo = spawn(process.execPath, [cli, 'start', ...expoArgs], {
    cwd: previewDir,
    stdio: 'inherit',
  });
  const child = expo;
  child.on('exit', (code, signal) => {
    if (expo !== child || shuttingDown) return; // Stopped on purpose.
    log(`Expo exited (${signal ?? code}).`);
    shutdown(code ?? 1);
  });
}

function stopExpo() {
  const child = expo;
  expo = null;
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  const exited = new Promise((resolve) => child.once('exit', resolve));
  // Expo starts worker processes; taskkill /T takes them down with it on Windows.
  if (isWin) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
  return exited;
}

let appliedTree = null;
let lastConflicts = '';
const lastGood = new Map();
// Worktrees with file changes since their last snapshot. The others reuse their snapshot.
const touched = new Set();

async function syncOnce() {
  const worktrees = selectWorktrees();
  watch(worktrees);
  const snaps = worktrees
    .map((wt) => {
      const key = norm(wt.path);
      if (lastGood.has(key) && !touched.has(key)) return lastGood.get(key);
      touched.delete(key);
      try {
        lastGood.set(key, snapshot(wt));
      } catch (error) {
        warn(`Couldn't read ${wt.name}, using its last snapshot: ${error.message}`);
      }
      return lastGood.get(key);
    })
    .filter(Boolean);
  if (snaps.length === 0) throw new Error('No worktrees to preview.');

  const { tree, lockFile, conflicts } = mergeAll(snaps);
  const conflictText = conflicts
    .map(
      ({ winner, files }) =>
        `${files.join(', ')}: changed in more than one worktree, showing ${winner}'s version (newest edit)`,
    )
    .join('\n');
  if (conflictText !== lastConflicts) {
    if (conflictText) conflictText.split('\n').forEach(warn);
    else if (lastConflicts) log('No conflicts between worktrees any more.');
    lastConflicts = conflictText;
  }
  if (tree === appliedTree) return;

  const changed = appliedTree
    ? nulList(git(['diff-tree', '-r', '--name-only', '-z', appliedTree, tree]))
    : null;
  git(['read-tree', '--reset', '-u', tree], { cwd: previewDir });
  appliedTree = tree;
  if (!changed) log(`Previewing ${snaps.map((snap) => snap.name).join(', ')}`);
  else if (changed.length <= 3) log(`Updated ${changed.join(', ')}`);
  else log(`Updated ${changed.length} files`);

  if (!depsInstalled(lockFile)) {
    await stopExpo();
    installDeps(lockFile);
  }
  if (!expo) startExpo();
}

let syncing = false;
let pending = false;
async function sync() {
  if (syncing) {
    pending = true;
    return;
  }
  syncing = true;
  try {
    do {
      pending = false;
      await syncOnce();
    } while (pending);
  } catch (error) {
    warn(error.message);
    if (!appliedTree) shutdown(1); // The first sync has to work.
  } finally {
    syncing = false;
  }
}

let timer = null;
const schedule = () => {
  clearTimeout(timer);
  timer = setTimeout(sync, 150);
};

const watchers = new Map();
function watch(worktrees) {
  const wanted = new Set(worktrees.map((wt) => norm(wt.path)));
  for (const [key, watcher] of watchers) {
    if (!wanted.has(key)) {
      watcher.close();
      watchers.delete(key);
    }
  }
  for (const wt of worktrees) {
    const key = norm(wt.path);
    if (watchers.has(key)) continue;
    const watcher = fs.watch(wt.path, { recursive: true }, (_event, file) => {
      if (file && IGNORED_DIRS.has(String(file).split(/[\\/]/)[0])) return;
      touched.add(key);
      editedAt.set(key, Date.now());
      schedule();
    });
    watcher.on('error', (error) => warn(`Stopped watching ${wt.name}: ${error.message}`));
    watchers.set(key, watcher);
  }
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const watcher of watchers.values()) watcher.close();
  stopExpo().then(() => process.exit(code));
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

try {
  ensurePreviewWorktree();
} catch (error) {
  warn(error.message);
  process.exit(1);
}
log(`Don't edit files in ${previewDir}. Every sync overwrites them.`);
sync();
// Without names, worktrees added later join the preview on their own.
let knownWorktrees = '';
setInterval(() => {
  const current = listWorktrees()
    .map((wt) => wt.path)
    .join('\n');
  if (knownWorktrees && current !== knownWorktrees) schedule();
  knownWorktrees = current;
}, 5000);
