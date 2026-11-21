import { isSideways, restsOpen, SWIPE_REVEAL } from './SwipeToDelete';

describe('isSideways', () => {
  it('takes a clearly sideways drag for the row', () => {
    expect(isSideways(-30, 4)).toBe(true);
    expect(isSideways(30, -4)).toBe(true);
  });

  it('leaves taps, wobbles and scrolls to the list', () => {
    expect(isSideways(-6, 0)).toBe(false); // too short: a tap
    expect(isSideways(-30, 25)).toBe(false); // diagonal
    expect(isSideways(2, -60)).toBe(false); // a scroll
  });
});

describe('restsOpen', () => {
  it('opens past half the Delete button and closes short of it', () => {
    expect(restsOpen(-SWIPE_REVEAL / 2 - 1, 0)).toBe(true);
    expect(restsOpen(-SWIPE_REVEAL / 2 + 1, 0)).toBe(false);
  });

  it('follows a flick whatever the distance', () => {
    expect(restsOpen(-10, -0.8)).toBe(true);
    expect(restsOpen(-SWIPE_REVEAL, 0.8)).toBe(false);
  });
});
