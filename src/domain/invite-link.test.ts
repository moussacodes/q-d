import { buildInviteLink, isInviteToken, parseInviteLink } from './invite-link';

const token = 'aB3_-x9QwErTyUiOpAsDfGhJkLzXcVbNm1234567890'; // 43 characters

describe('invite tokens', () => {
  it('are 43 URL-safe base64 characters', () => {
    expect(token).toHaveLength(43);
    expect(isInviteToken(token)).toBe(true);
    expect(isInviteToken(token.slice(1))).toBe(false);
    expect(isInviteToken(`${token}A`)).toBe(false);
    expect(isInviteToken(`${token.slice(1)}+`)).toBe(false);
    expect(isInviteToken(`${token.slice(1)}=`)).toBe(false);
    expect(isInviteToken('')).toBe(false);
  });

  it('are never a room code', () => {
    expect(isInviteToken('7K4F9X')).toBe(false);
    expect(isInviteToken('QD-7K4F9X')).toBe(false);
  });
});

describe('buildInviteLink', () => {
  it('builds the qd://join link the QR code encodes', () => {
    expect(buildInviteLink(token)).toBe(`qd://join?invite=${token}`);
  });

  it('refuses anything that is not a token', () => {
    expect(() => buildInviteLink('7K4F9X')).toThrow('Not an invite token');
    expect(() => buildInviteLink(`${token}&x=1`)).toThrow();
  });
});

describe('parseInviteLink', () => {
  it('reads the token back from a built link', () => {
    expect(parseInviteLink(buildInviteLink(token))).toBe(token);
  });

  it.each([
    ['a triple slash', `qd:///join?invite=${token}`],
    ['a trailing slash', `qd://join/?invite=${token}`],
    ['upper-case scheme and path', `QD://JOIN?invite=${token}`],
    ['other parameters around it', `qd://join?utm=x&invite=${token}&b=2`],
    ['a fragment', `qd://join?invite=${token}#top`],
    ['surrounding spaces', `  qd://join?invite=${token}\n`],
  ])('accepts %s', (_label, link) => {
    expect(parseInviteLink(link)).toBe(token);
  });

  it.each([
    ['another scheme', `https://join?invite=${token}`],
    ['another path', `qd://room?invite=${token}`],
    ['no query', 'qd://join'],
    ['no invite parameter', `qd://join?code=${token}`],
    ['a room code instead of a token', 'qd://join?invite=7K4F9X'],
    ['a truncated token', `qd://join?invite=${token.slice(0, 40)}`],
    ['broken percent-encoding', 'qd://join?invite=%E0%A4%A'],
    ['an empty string', ''],
  ])('rejects %s', (_label, link) => {
    expect(parseInviteLink(link)).toBeNull();
  });
});
