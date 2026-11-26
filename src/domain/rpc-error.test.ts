import { isRpcErrorCode, rpcErrorCodes } from './rpc-error';

const fs = jest.requireActual<{ readFileSync(path: string, encoding: 'utf8'): string }>('fs');

describe('rpcErrorCodes', () => {
  it('matches the table in docs/API_CONTRACTS.md §2, in order', () => {
    const doc = fs.readFileSync(`${process.cwd()}/docs/API_CONTRACTS.md`, 'utf8');
    const section = doc.slice(doc.indexOf('## 2. Error codes'), doc.indexOf('## 3. RPC functions'));
    const codes = [...section.matchAll(/^\| `([a-z_]+)` \|/gm)].map((match) => match[1]);
    expect(codes.length).toBeGreaterThan(0);
    expect([...rpcErrorCodes].sort()).toEqual([...codes].sort());
  });

  it('knows its own codes and nothing else', () => {
    expect(isRpcErrorCode('room_full')).toBe(true);
    expect(isRpcErrorCode('network')).toBe(false);
    expect(isRpcErrorCode('Room_Full')).toBe(false);
    expect(isRpcErrorCode(42)).toBe(false);
    expect(isRpcErrorCode(undefined)).toBe(false);
  });
});
