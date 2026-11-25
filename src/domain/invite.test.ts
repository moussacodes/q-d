import { inviteLink, inviteTokenFromLink, isMockInviteToken } from './invite';

describe('invite links', () => {
  it('put the token in qd://join?invite=', () => {
    expect(inviteLink('mock-abc')).toBe('qd://join?invite=mock-abc');
  });

  it('encode anything a URL can’t carry as is', () => {
    expect(inviteLink('a b&c')).toBe('qd://join?invite=a%20b%26c');
    expect(inviteTokenFromLink(inviteLink('a b&c'))).toBe('a b&c');
  });

  it('read the token back, and nothing from other text', () => {
    expect(inviteTokenFromLink('qd://join?invite=xyz')).toBe('xyz');
    expect(inviteTokenFromLink('qd://join?invite=')).toBeNull();
    expect(inviteTokenFromLink('https://example.com/?invite=xyz')).toBeNull();
    expect(inviteTokenFromLink('QD-7K4F9X')).toBeNull();
  });

  it('tell a mock token from a real one', () => {
    expect(isMockInviteToken('mock-123')).toBe(true);
    expect(isMockInviteToken('Zx8_k2')).toBe(false);
  });
});
