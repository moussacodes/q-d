/**
 * QR invites (docs/API_CONTRACTS.md, `create_room_invite`). The QR code and
 * the shared link carry a high-entropy invite token, never the short room
 * code, so neither can be guessed from the other (PRODUCT_SPEC.md §4).
 */

/** Where an invite link opens the app: Expo Router's `/join` route. Universal links come later. */
export const INVITE_LINK_BASE = 'qd://join';

/** Mock tokens start with this, so a mock link can never pass for a real one. */
export const MOCK_INVITE_PREFIX = 'mock-';

/** `qd://join?invite=<token>`, what the QR code encodes and Copy link copies. */
export function inviteLink(token: string) {
  return `${INVITE_LINK_BASE}?invite=${encodeURIComponent(token)}`;
}

/** The token in an invite link, or null when the text isn't one. */
export function inviteTokenFromLink(link: string): string | null {
  const prefix = `${INVITE_LINK_BASE}?invite=`;
  if (!link.startsWith(prefix)) return null;
  const token = decodeURIComponent(link.slice(prefix.length));
  return token.length > 0 ? token : null;
}

export function isMockInviteToken(token: string) {
  return token.startsWith(MOCK_INVITE_PREFIX);
}
