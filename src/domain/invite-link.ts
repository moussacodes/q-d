/**
 * QR invite links (API_CONTRACTS.md § create_room_invite and § 7).
 *
 * A QR code encodes `qd://join?invite=<token>`. The token comes from
 * `create_room_invite`: 43 URL-safe base64 characters (more than 128 bits of
 * entropy), never the short room code. Universal links can come later.
 */

/** The shape of an invite token: 32 random bytes as unpadded base64url. */
export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isInviteToken(value: string): boolean {
  return INVITE_TOKEN_PATTERN.test(value);
}

/** The link a QR invite encodes. Throws for something that isn't a token. */
export function buildInviteLink(token: string): string {
  if (!isInviteToken(token)) {
    throw new Error('Not an invite token');
  }
  return `qd://join?invite=${token}`;
}

/**
 * The token from a scanned or opened invite link, or null when the link isn't
 * a q’d invite. Accepts `qd://join?invite=…` (and `qd:///join`, the form some
 * routers produce), in any case for the scheme and path, with other query
 * parameters around it. A room code is never accepted as a token.
 */
export function parseInviteLink(link: string): string | null {
  const match = /^qd:\/\/\/?join\/?\?([^#]*)(#.*)?$/i.exec(link.trim());
  if (!match) return null;
  for (const pair of match[1].split('&')) {
    const [name, ...rest] = pair.split('=');
    if (name !== 'invite') continue;
    let value: string;
    try {
      value = decodeURIComponent(rest.join('='));
    } catch {
      return null;
    }
    return isInviteToken(value) ? value : null;
  }
  return null;
}
