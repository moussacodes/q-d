/**
 * Edge Functions can't import src/ (Supabase deploys only supabase/functions),
 * so supabase/functions/_shared/matching-text.ts is a copy of the app's
 * matching text rules. This keeps the copy identical to the source.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as shared from '../../functions/_shared/matching-text';
import * as source from '../../../src/domain/matching/text';

const ROOT = join(__dirname, '..', '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8').replace(/\r\n/g, '\n');

describe('supabase/functions/_shared/matching-text.ts', () => {
  it('is src/domain/matching/text.ts under a copy banner', () => {
    const copy = read('supabase/functions/_shared/matching-text.ts');
    const original = read('src/domain/matching/text.ts');
    const banner = copy.slice(0, copy.length - original.length);
    expect(copy.endsWith(original)).toBe(true);
    // Only comment lines and blank lines may come before the copied code.
    expect(banner.split('\n').every((line) => line === '' || line.startsWith('//'))).toBe(true);
  });

  it('exports the same rules', () => {
    expect(Object.keys(shared).sort()).toEqual(Object.keys(source).sort());
    const title = 'Rain Down (Live) [feat. Delerium & Sarah McLachlan]';
    expect(shared.parseTitle(title, ['Delerium'])).toEqual(source.parseTitle(title, ['Delerium']));
  });

  it('is the only way catalog-search reaches the matching rules', () => {
    const apple = read('supabase/functions/catalog-search/apple.ts');
    expect(apple).toContain("from '../_shared/matching-text.ts'");
    expect(apple).not.toMatch(/from '(\.\.\/){3,}src\//);
  });
});
