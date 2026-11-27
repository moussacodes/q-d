import fs from 'node:fs';
import path from 'node:path';

import { loadAll } from 'js-yaml';

// Static checks for the Maestro flows in .maestro/ (Forge card "Maestro smoke
// flows"). The flows only run on the Mac against a development build, so this
// test is what keeps them honest on every `npm test`: each file parses, names
// the app, starts clean, uses no real account or secret, calls subflows that
// exist, and every text or id it looks for is still in the app's source. When
// screen copy changes, this fails until the flow is updated with it.

const ROOT = path.resolve(__dirname, '..');
const MAESTRO_DIR = path.join(ROOT, '.maestro');
const APP_ID = 'app.qd.mobile';

/**
 * Selectors a flow may assert are NOT visible without them existing in the
 * source: the guardrails (PRODUCT_SPEC.md §2 and §9) say these never appear.
 */
const NEVER_SHOWN = new Set([
  'YouTube Music',
  'TIDAL',
  'Amazon Music',
  'Deezer',
  '.*[Ss]ync \\(beta\\).*',
]);

/** Commands whose value is an element selector. */
const SELECTOR_COMMANDS = ['tapOn', 'doubleTapOn', 'longPressOn', 'assertVisible', 'copyTextFrom'];
const NEGATIVE_COMMANDS = ['assertNotVisible'];
/** Selector keys that hold another selector (relative position). */
const RELATIVE_KEYS = ['below', 'above', 'leftOf', 'rightOf', 'containsChild', 'childOf'];

type Selector = { text?: string; id?: string; negative: boolean; command: string };
type Flow = {
  file: string;
  config: Record<string, unknown>;
  commands: unknown[];
  raw: string;
};

function listYaml(dir: string): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
    .map((entry) => path.join(dir, entry.name))
    .sort();
}

function readFlow(file: string): Flow {
  const raw = fs.readFileSync(file, 'utf8');
  const docs = loadAll(raw) as unknown[];
  if (docs.length !== 2) {
    throw new Error(`${file}: expected a config section, "---", then commands`);
  }
  const [config, commands] = docs;
  if (!isRecord(config) || !Array.isArray(commands)) {
    throw new Error(`${file}: config must be a map and commands a list`);
  }
  return { file, config, commands, raw };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Every command in a flow, including ones nested in repeat, retry or runFlow's `commands`. */
function eachCommand(commands: unknown[], visit: (name: string, value: unknown) => void) {
  for (const command of commands) {
    if (typeof command === 'string') {
      visit(command, null);
      continue;
    }
    if (!isRecord(command)) continue;
    for (const [name, value] of Object.entries(command)) {
      visit(name, value);
      if (isRecord(value) && Array.isArray(value.commands)) eachCommand(value.commands, visit);
    }
  }
}

function selectorsOf(value: unknown, command: string, negative: boolean): Selector[] {
  if (typeof value === 'string') return [{ text: value, negative, command }];
  if (!isRecord(value)) return [];
  const own: Selector[] = [];
  if (typeof value.text === 'string' || typeof value.id === 'string') {
    own.push({
      text: typeof value.text === 'string' ? value.text : undefined,
      id: typeof value.id === 'string' ? value.id : undefined,
      negative,
      command,
    });
  }
  for (const key of RELATIVE_KEYS) {
    if (key in value) own.push(...selectorsOf(value[key], command, negative));
  }
  return own;
}

function flowSelectors(flow: Flow): Selector[] {
  const found: Selector[] = [];
  eachCommand(flow.commands, (name, value) => {
    if (SELECTOR_COMMANDS.includes(name)) found.push(...selectorsOf(value, name, false));
    if (NEGATIVE_COMMANDS.includes(name)) found.push(...selectorsOf(value, name, true));
    if (name === 'scrollUntilVisible' && isRecord(value)) {
      found.push(...selectorsOf(value.element, name, false));
    }
    if (name === 'extendedWaitUntil' && isRecord(value)) {
      found.push(...selectorsOf(value.visible, name, false));
      found.push(...selectorsOf(value.notVisible, name, true));
    }
  });
  return found;
}

function flowInputs(flow: Flow): string[] {
  const inputs: string[] = [];
  eachCommand(flow.commands, (name, value) => {
    if (name === 'inputText' && typeof value === 'string') inputs.push(value);
  });
  return inputs;
}

function runFlowTargets(flow: Flow): string[] {
  const targets: string[] = [];
  eachCommand(flow.commands, (name, value) => {
    if (name !== 'runFlow') return;
    const file = typeof value === 'string' ? value : isRecord(value) ? value.file : undefined;
    if (typeof file === 'string') targets.push(path.resolve(path.dirname(flow.file), file));
  });
  return targets;
}

// --- The app's source, as the selectors see it -----------------------------

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'test' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const collapse = (text: string) => text.replace(/\s+/g, ' ');
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type Corpus = { text: string; templates: RegExp[]; testIds: Set<string> };

function buildCorpus(sources: string[]): Corpus {
  const templates: RegExp[] = [];
  const testIds = new Set<string>();
  for (const source of sources) {
    for (const match of source.matchAll(/`((?:[^`\\]|\\.)*)`/g)) {
      const parts = match[1].split(/\$\{[^}]*\}/);
      if (parts.length < 2) continue;
      templates.push(new RegExp(`^${parts.map((p) => escapeRegex(collapse(p))).join('.+')}$`));
    }
    for (const match of source.matchAll(/testID=(?:"([^"]+)"|\{'([^']+)'\}|'([^']+)')/g)) {
      testIds.add(match[1] ?? match[2] ?? match[3]);
    }
  }
  return { text: collapse(sources.join('\n')), templates, testIds };
}

/**
 * Why a selector doesn't resolve, or null when it does. Text selectors are
 * Maestro regexes: `.*` and `.+` split them into literal pieces, and each
 * piece must be in the source (or in a template literal's shape, or typed by
 * the flow itself). Copy uses the curly apostrophe, so a straight one is a
 * mistake.
 */
function unresolved(selector: Selector, corpus: Corpus, inputs: string[]): string | null {
  if (selector.id !== undefined && !corpus.testIds.has(selector.id)) {
    return `no testID "${selector.id}" in app/ or src/`;
  }
  const text = selector.text;
  if (text === undefined) return null;
  if (selector.negative && NEVER_SHOWN.has(text)) return null;
  try {
    new RegExp(text);
  } catch {
    return `"${text}" isn't a valid regex`;
  }
  if (text.includes("'")) return `"${text}" uses a straight apostrophe; app copy uses ’`;
  const pieces = text
    .split(/\.\*|\.\+/)
    .map((piece) => piece.replace(/\\(.)/g, '$1').trim())
    .filter(Boolean);
  if (pieces.length === 0) return `"${text}" matches anything`;
  for (const piece of pieces) {
    if (/[[\]|^$]/.test(piece))
      return `"${text}": "${piece}" uses regex syntax the check can't read`;
    const found =
      corpus.text.includes(piece) ||
      inputs.some((input) => input.includes(piece)) ||
      corpus.templates.some((template) => template.test(piece));
    if (!found) return `"${piece}" (from "${text}") isn't in app/ or src/`;
  }
  return null;
}

// --- The checks -------------------------------------------------------------

const topLevel = listYaml(MAESTRO_DIR).map(readFlow);
const subflows = listYaml(path.join(MAESTRO_DIR, 'subflows')).map(readFlow);
const allFlows = [...topLevel, ...subflows];
const corpus = buildCorpus(
  [...sourceFiles(path.join(ROOT, 'app')), ...sourceFiles(path.join(ROOT, 'src'))].map((file) =>
    fs.readFileSync(file, 'utf8'),
  ),
);
const name = (flow: Flow) => path.relative(MAESTRO_DIR, flow.file).replace(/\\/g, '/');

describe('Maestro flows', () => {
  it('has the smoke flows the card asks for, plus their subflows', () => {
    expect(topLevel.map(name)).toEqual(
      expect.arrayContaining([
        'onboarding.yaml',
        'sign-in.yaml',
        'start-room.yaml',
        'invite.yaml',
        'join-with-code.yaml',
        'add-song-queue.yaml',
        'host-reconnecting.yaml',
        'offline.yaml',
        'room-ended.yaml',
        'settings-services.yaml',
        'smoke.yaml',
      ]),
    );
    expect(subflows.map(name)).toEqual(
      expect.arrayContaining(['subflows/sign-in.yaml', 'subflows/sign-up.yaml']),
    );
  });

  it.each(allFlows.map((flow) => [name(flow), flow] as const))(
    '%s names the development build and has a name',
    (_, flow) => {
      expect(flow.config.appId).toBe(APP_ID);
      expect(typeof flow.config.name).toBe('string');
      expect(flow.commands.length).toBeGreaterThan(0);
    },
  );

  it.each(topLevel.map((flow) => [name(flow), flow] as const))(
    '%s starts from a clean install',
    (_, flow) => {
      expect(flow.commands[0]).toEqual({ launchApp: { clearState: true } });
    },
  );

  it.each(allFlows.map((flow) => [name(flow), flow] as const))(
    '%s uses no real account, password or secret',
    (_, flow) => {
      const emails = flow.raw.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g) ?? [];
      expect(emails.filter((email) => !/@example\.(com|org|net)$/.test(email))).toEqual([]);
      expect(flow.raw).not.toMatch(/eyJ[\w-]{10,}\.[\w-]{10,}/); // a JWT
      expect(flow.raw).not.toMatch(/sb_secret_|sb_publishable_|service_role|sk_(live|test)_/i);
      expect(flow.raw).not.toMatch(/supabase\.co|EXPO_PUBLIC_\w+\s*[:=]\s*\S/);
      // Mock sign-in needs no password, so no flow types one.
      const selectors = flowSelectors(flow).map((s) => s.text ?? s.id);
      expect(selectors).not.toContain('Password');
    },
  );

  it.each(allFlows.map((flow) => [name(flow), flow] as const))(
    '%s only runs subflows that exist',
    (_, flow) => {
      for (const target of runFlowTargets(flow)) {
        expect(fs.existsSync(target) ? target : `missing: ${target}`).toBe(target);
      }
    },
  );

  it('uses every subflow somewhere', () => {
    const used = new Set(allFlows.flatMap(runFlowTargets));
    expect(subflows.filter((flow) => !used.has(flow.file)).map(name)).toEqual([]);
  });

  it.each(allFlows.map((flow) => [name(flow), flow] as const))(
    '%s only looks for text and ids the app still has',
    (_, flow) => {
      const inputs = flowInputs(flow);
      const problems = flowSelectors(flow)
        .map((selector) => unresolved(selector, corpus, inputs))
        .filter(Boolean);
      expect(problems).toEqual([]);
    },
  );

  it.each(allFlows.map((flow) => [name(flow), flow] as const))(
    '%s never expects to see a provider or mode q’d doesn’t offer',
    (_, flow) => {
      const shown = flowSelectors(flow).filter((s) => !s.negative && s.text);
      for (const selector of shown) {
        expect(selector.text).not.toMatch(/YouTube|TIDAL|Amazon|Deezer|sync/i);
      }
    },
  );

  it('lists every flow in .maestro/README.md', () => {
    const readme = fs.readFileSync(path.join(MAESTRO_DIR, 'README.md'), 'utf8');
    for (const flow of allFlows) expect(readme).toContain(name(flow));
  });
});

describe('the selector check itself', () => {
  const sample = buildCorpus([
    "const a = 'Start room';",
    'const b = `Move ${title} up`;',
    '<Text>Room codes don’t use 0, O, 1 or I.</Text>',
    '<View testID="queue-list" />',
  ]);
  const text = (value: string, negative = false): Selector => ({
    text: value,
    negative,
    command: 'assertVisible',
  });

  it('finds literals, template shapes, regex pieces, typed input and testIDs', () => {
    expect(unresolved(text('Start room'), sample, [])).toBeNull();
    expect(unresolved(text('Move Lovers Rock up'), sample, [])).toBeNull();
    expect(unresolved(text('Room codes don’t use 0, O, 1 or I.*'), sample, [])).toBeNull();
    expect(unresolved(text('.*Mock Guest.*'), sample, ['Mock Guest'])).toBeNull();
    expect(unresolved({ id: 'queue-list', negative: false, command: 'tapOn' }, sample, [])).toBe(
      null,
    );
  });

  it('reports copy that is gone, a straight apostrophe, an unknown id and a match-all', () => {
    expect(unresolved(text('Start the room'), sample, [])).toMatch(/isn't in app/);
    expect(unresolved(text("Room codes don't use.*"), sample, [])).toMatch(/straight apostrophe/);
    expect(unresolved({ id: 'nope', negative: false, command: 'tapOn' }, sample, [])).toMatch(
      /no testID/,
    );
    expect(unresolved(text('.*'), sample, [])).toMatch(/matches anything/);
    expect(unresolved(text('(unclosed'), sample, [])).toMatch(/valid regex/);
  });

  it('lets a guardrail be asserted absent without being in the source', () => {
    expect(unresolved(text('Deezer', true), sample, [])).toBeNull();
    expect(unresolved(text('Deezer'), sample, [])).toMatch(/isn't in app/);
  });
});
