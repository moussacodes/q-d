/**
 * Who may do what in a room (docs/PRODUCT_SPEC.md §4). The host sets two
 * rules: who adds songs, and who controls the music (play, pause, skip,
 * reorder, remove). The host can always do both.
 */

/** Who a rule lets in. `host` means only the host. */
export type Audience = 'everyone' | 'chosen' | 'host';

export type RoomRule = {
  who: Audience;
  /**
   * Ids of the members the host picked. They count only while `who` is
   * `chosen`, but they're kept when it changes, so switching back restores them.
   */
  chosen: string[];
};

export type RoomRules = {
  addSongs: RoomRule;
  /** Play, pause, skip, reorder and remove. */
  control: RoomRule;
};

export type RuleName = keyof RoomRules;

export const ruleNames: readonly RuleName[] = ['addSongs', 'control'];

/** A new room: everyone adds songs, and only the host controls the music. */
export const defaultRoomRules: RoomRules = {
  addSongs: { who: 'everyone', chosen: [] },
  control: { who: 'host', chosen: [] },
};

export type RuleMember = { id: string; isHost?: boolean };

/** Whether the rule lets this member in. Someone who isn't a member can't do anything. */
export function allows(rule: RoomRule, member: RuleMember | null | undefined): boolean {
  if (!member) return false;
  if (member.isHost) return true;
  switch (rule.who) {
    case 'everyone':
      return true;
    case 'chosen':
      return rule.chosen.includes(member.id);
    case 'host':
      return false;
  }
}

export function setAudience(rules: RoomRules, name: RuleName, who: Audience): RoomRules {
  return { ...rules, [name]: { ...rules[name], who } };
}

/** Adds the member to the rule's chosen people, or takes them off. */
export function toggleChosen(rules: RoomRules, name: RuleName, memberId: string): RoomRules {
  const { chosen } = rules[name];
  const next = chosen.includes(memberId)
    ? chosen.filter((id) => id !== memberId)
    : [...chosen, memberId];
  return { ...rules, [name]: { ...rules[name], chosen: next } };
}
