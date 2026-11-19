import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { findRoom, mockUser, type MockRoom } from '@/providers/mock/data';

/**
 * Screen-shell session state: who "you" are and which room is playing.
 * Mock only; real auth and room state come from Supabase later.
 */
type MockSessionValue = {
  user: typeof mockUser;
  activeRoom: MockRoom | null;
  enterRoom: (code: string) => void;
  leaveRoom: () => void;
};

const MockSessionContext = createContext<MockSessionValue | null>(null);

export function MockSessionProvider({ children }: { children: ReactNode }) {
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const value = useMemo<MockSessionValue>(
    () => ({
      user: mockUser,
      activeRoom: activeCode ? findRoom(activeCode) : null,
      enterRoom: setActiveCode,
      leaveRoom: () => setActiveCode(null),
    }),
    [activeCode],
  );
  return <MockSessionContext.Provider value={value}>{children}</MockSessionContext.Provider>;
}

export function useMockSession() {
  const value = useContext(MockSessionContext);
  if (!value) {
    throw new Error('useMockSession must be used inside <MockSessionProvider>');
  }
  return value;
}
