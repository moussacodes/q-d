import { reconcileConnections } from './provider-connection';

describe('reconcileConnections', () => {
  it('removes the row of a service with nothing usable on this phone', () => {
    expect(reconcileConnections({ spotify: 'unusable' })).toEqual({
      remove: ['spotify'],
      record: [],
    });
  });

  it('records (or marks checked) a usable real connection', () => {
    expect(reconcileConnections({ spotify: 'usable' })).toEqual({
      remove: [],
      record: ['spotify'],
    });
  });

  it('never touches a service this build can’t check, either way', () => {
    expect(reconcileConnections({ apple_music: 'unknown', spotify: 'unknown' })).toEqual({
      remove: [],
      record: [],
    });
    expect(reconcileConnections({})).toEqual({ remove: [], record: [] });
  });

  it('handles each service on its own, in a stable order', () => {
    expect(reconcileConnections({ spotify: 'usable', apple_music: 'unusable' })).toEqual({
      remove: ['apple_music'],
      record: ['spotify'],
    });
    expect(reconcileConnections({ spotify: 'unusable', apple_music: 'unknown' })).toEqual({
      remove: ['spotify'],
      record: [],
    });
  });
});
