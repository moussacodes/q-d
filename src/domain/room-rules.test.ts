import { allows, defaultRoomRules, setAudience, toggleChosen, type RoomRule } from './room-rules';

const host = { id: 'baron', isHost: true };
const maya = { id: 'maya' };
const jules = { id: 'jules' };

describe('room rules', () => {
  it('starts with everyone adding songs and only the host in control', () => {
    expect(allows(defaultRoomRules.addSongs, maya)).toBe(true);
    expect(allows(defaultRoomRules.control, maya)).toBe(false);
    expect(allows(defaultRoomRules.control, host)).toBe(true);
  });

  it('always lets the host in', () => {
    const rules: RoomRule[] = [
      { who: 'everyone', chosen: [] },
      { who: 'chosen', chosen: [] },
      { who: 'host', chosen: [] },
    ];
    rules.forEach((rule) => expect(allows(rule, host)).toBe(true));
  });

  it('lets in only the chosen people while the rule is "chosen"', () => {
    const rule: RoomRule = { who: 'chosen', chosen: ['maya'] };
    expect(allows(rule, maya)).toBe(true);
    expect(allows(rule, jules)).toBe(false);
  });

  it('ignores the chosen people under the other choices', () => {
    expect(allows({ who: 'host', chosen: ['maya'] }, maya)).toBe(false);
    expect(allows({ who: 'everyone', chosen: [] }, jules)).toBe(true);
  });

  it('lets nobody in who is not a member', () => {
    expect(allows({ who: 'everyone', chosen: [] }, undefined)).toBe(false);
    expect(allows({ who: 'everyone', chosen: [] }, null)).toBe(false);
  });

  it('keeps the chosen people when the choice changes, so switching back restores them', () => {
    const picked = toggleChosen(
      setAudience(defaultRoomRules, 'control', 'chosen'),
      'control',
      'maya',
    );
    const back = setAudience(setAudience(picked, 'control', 'everyone'), 'control', 'chosen');
    expect(back.control).toEqual({ who: 'chosen', chosen: ['maya'] });
  });

  it('chooses and un-chooses people per rule', () => {
    const once = toggleChosen(defaultRoomRules, 'addSongs', 'maya');
    expect(once.addSongs.chosen).toEqual(['maya']);
    expect(once.control.chosen).toEqual([]);
    expect(toggleChosen(once, 'addSongs', 'maya').addSongs.chosen).toEqual([]);
  });

  it('never changes the rules it was given', () => {
    const before = JSON.stringify(defaultRoomRules);
    toggleChosen(setAudience(defaultRoomRules, 'addSongs', 'chosen'), 'addSongs', 'maya');
    expect(JSON.stringify(defaultRoomRules)).toBe(before);
  });
});
