import { roomCodeFromInput } from './room-code';

describe('roomCodeFromInput', () => {
  it('uppercases what was typed', () => {
    expect(roomCodeFromInput('9m2xr4')).toBe('9M2XR4');
  });

  it('removes a pasted QD- prefix', () => {
    expect(roomCodeFromInput('QD-9M2XR4')).toBe('9M2XR4');
    expect(roomCodeFromInput('qd 9m2 xr4')).toBe('9M2XR4');
  });

  it('keeps a code that starts with QD', () => {
    expect(roomCodeFromInput('QD12AB')).toBe('QD12AB');
  });

  it('stops at six characters', () => {
    expect(roomCodeFromInput('9M2XR4ZZ')).toBe('9M2XR4');
  });
});
