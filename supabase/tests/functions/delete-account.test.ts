/**
 * The delete-account Edge Function placeholder answers honestly until the
 * account-deletion card builds it.
 */
import { handler } from '../../functions/delete-account';

const call = (init: RequestInit) => handler(new Request('http://localhost/delete-account', init));

describe('delete-account placeholder', () => {
  it('accepts POST only', async () => {
    const response = await call({ method: 'GET' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(await response.json()).toEqual({ code: 'invalid_input' });
  });

  it('needs a bearer token', async () => {
    const response = await call({ method: 'POST' });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: 'not_authenticated' });
  });

  it('says it is not available yet', async () => {
    const response = await call({ method: 'POST', headers: { authorization: 'Bearer abc' } });
    expect(response.status).toBe(501);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({ code: 'feature_disabled' });
  });
});
