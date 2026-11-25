import {
  markersIn,
  normalizeIsrc,
  normalizeText,
  parseTitle,
  similarity,
  splitArtists,
} from './text';

describe('normalizeText', () => {
  it.each([
    ['Rain Down', 'rain down'],
    ['  RAIN   DOWN!  ', 'rain down'],
    ['Beyoncé', 'beyonce'],
    ['Sigur Rós', 'sigur ros'],
    ['Motörhead', 'motorhead'],
    ['Straße', 'strasse'],
    ['Røyksopp', 'royksopp'],
    ['Don’t Stop', 'dont stop'],
    ["Don't Stop", 'dont stop'],
    ['Simon & Garfunkel', 'simon and garfunkel'],
    ['Florence + the Machine', 'florence and the machine'],
    ['AC/DC', 'ac dc'],
    ['P!nk', 'p nk'],
    ['東京フラワー', '東京フラワー'],
    ['ＡＢＣ', 'abc'],
    ['', ''],
  ])('%p → %p', (input, output) => {
    expect(normalizeText(input)).toBe(output);
  });
});

describe('splitArtists', () => {
  it.each([
    [['Daniel Caesar'], ['daniel caesar']],
    [['Delerium & Sarah McLachlan'], ['delerium', 'sarah mclachlan']],
    [
      ['Delerium', 'Sarah McLachlan'],
      ['delerium', 'sarah mclachlan'],
    ],
    [['Delerium feat. Sarah McLachlan'], ['delerium', 'sarah mclachlan']],
    [['Delerium ft Sarah McLachlan'], ['delerium', 'sarah mclachlan']],
    [['Delerium featuring Sarah McLachlan'], ['delerium', 'sarah mclachlan']],
    [['A, B and C'], ['a', 'b', 'c']],
    [['A', 'a', 'Á'], ['a']],
    [[''], []],
  ])('%p → %p', (credits, names) => {
    expect(splitArtists(credits)).toEqual(names);
  });
});

describe('markersIn', () => {
  it.each([
    ['Live at Wembley', ['live']],
    ['2011 Remaster', ['remastered']],
    ['Remastered 2009', ['remastered']],
    ['Radio Edit', ['radio_edit']],
    ['Acoustic Version', ['acoustic']],
    ['Unplugged', ['acoustic']],
    ['Sped Up', ['sped_up']],
    ['Slowed + Reverb', ['slowed']],
    ['Instrumental', ['instrumental']],
    ['Clean', ['clean']],
    ['Skrillex Remix', ['remix']],
    ['Extended Mix', ['extended']],
    ['Demo', ['demo']],
    ['Karaoke Version', ['karaoke']],
    ['A Cappella', ['a_cappella']],
    ['Live Acoustic', ['live', 'acoustic']],
    ['Deluxe Edition', []],
    ['From the Movie', []],
  ])('%p → %p', (segment, markers) => {
    expect(markersIn(segment)).toEqual(markers);
  });
});

describe('parseTitle', () => {
  it.each([
    ['Rain Down', [], { core: 'rain down', markers: [], featured: [] }],
    [
      'Rain Down (feat. Sarah McLachlan)',
      [],
      { core: 'rain down', markers: [], featured: ['sarah mclachlan'] },
    ],
    [
      'Rain Down feat. Sarah McLachlan',
      [],
      { core: 'rain down', markers: [], featured: ['sarah mclachlan'] },
    ],
    [
      'Rain Down [Live] (feat. Sarah McLachlan)',
      [],
      { core: 'rain down', markers: ['live'], featured: ['sarah mclachlan'] },
    ],
    ['Rain Down - 2011 Remaster', [], { core: 'rain down', markers: ['remastered'], featured: [] }],
    [
      'Rain Down - Live / Remastered',
      [],
      { core: 'rain down', markers: ['live', 'remastered'], featured: [] },
    ],
    ['Live Forever', [], { core: 'live forever', markers: [], featured: [] }],
    ['Slowed Down', [], { core: 'slowed down', markers: [], featured: [] }],
    [
      'Have a Baby (With Me)',
      ['Daniel Caesar'],
      { core: 'have a baby with me', markers: [], featured: [] },
    ],
    [
      'Lovers Rock (with Brent Faiyaz)',
      ['Daniel Caesar', 'Brent Faiyaz'],
      { core: 'lovers rock', markers: [], featured: ['brent faiyaz'] },
    ],
    ['Part 1 - Part 2', [], { core: 'part 1 part 2', markers: [], featured: [] }],
    ['Song (Deluxe Edition)', [], { core: 'song deluxe edition', markers: [], featured: [] }],
  ])('%p', (title, artists, parsed) => {
    expect(parseTitle(title, artists)).toEqual(parsed);
  });
});

describe('normalizeIsrc', () => {
  it.each([
    ['USRC17607839', 'USRC17607839'],
    ['usrc17607839', 'USRC17607839'],
    ['US-RC1-76-07839', 'USRC17607839'],
    [' US RC1 76 07839 ', 'USRC17607839'],
    ['USRC1760783', null],
    ['', null],
    [null, null],
    [undefined, null],
  ])('%p → %p', (input, output) => {
    expect(normalizeIsrc(input)).toBe(output);
  });
});

describe('similarity', () => {
  it('is 1 for equal text and 0 for nothing in common', () => {
    expect(similarity('rain down', 'rain down')).toBe(1);
    expect(similarity('rain down', 'raindown')).toBe(1);
    expect(similarity('abc', 'xyz')).toBe(0);
  });

  it('is symmetric and between 0 and 1', () => {
    const value = similarity('moon', 'moonlight');
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(1);
    expect(similarity('moonlight', 'moon')).toBe(value);
  });

  it('handles one-letter strings', () => {
    expect(similarity('a', 'a')).toBe(1);
    expect(similarity('a', 'b')).toBe(0);
  });
});
