import { providerNames } from '@/domain/music-provider';

import { findRoom, mockQueue, mockRooms, mockSearchResults, mockUser } from './mock-data';

// The screen shells are reviewed against this data, so it has to follow the
// product rules in plan.md §2 or the shells will show impossible states.
describe('mock data', () => {
  it('uses six-character room codes', () => {
    for (const room of mockRooms) {
      expect(room.code).toMatch(/^QD-[A-Z0-9]{6}$/);
    }
  });

  it('has unique room codes', () => {
    const codes = mockRooms.map((room) => room.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('gives every room exactly one host, within the 15-person limit', () => {
    for (const room of mockRooms) {
      const hosts = room.people.filter((person) => person.isHost);
      expect(hosts).toHaveLength(1);
      expect(room.people.length).toBeLessThanOrEqual(15);
    }
  });

  it('puts you in every room, as the host exactly where you host', () => {
    for (const room of mockRooms) {
      const you = room.people.find((person) => person.id === mockUser.id);
      expect(you).toBeDefined();
      expect(!!you?.isHost).toBe(room.youHost);
      expect(room.people.find((person) => person.isHost)?.name).toBe(room.hostName);
    }
  });

  it('only connects a music service for the host (aux mode)', () => {
    for (const room of mockRooms) {
      for (const person of room.people) {
        if (!person.isHost) {
          expect(person.provider).toBeUndefined();
        }
      }
    }
  });

  it('only uses supported providers', () => {
    const supported = Object.keys(providerNames);
    const tracks = [...mockQueue, ...mockSearchResults, ...mockRooms.flatMap((r) => r.queue)];
    for (const track of tracks) {
      expect(supported).toContain(track.provider);
    }
    for (const room of mockRooms) {
      expect(supported).toContain(room.playsThrough);
    }
  });

  it('finds a room by code and falls back to the first room', () => {
    expect(findRoom('QD-9M2XR4').name).toBe('Kitchen Disco');
    expect(findRoom('QD-NOPE00')).toBe(mockRooms[0]);
    expect(findRoom(undefined)).toBe(mockRooms[0]);
  });
});
