import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { Share } from 'react-native';

import { MockRoomServer, type RoomInvite } from '@/features/room/mockServer';
import { addLogSink, type LogEntry } from '@/services/logger';
import { setCrashTransport, type CrashEvent } from '@/services/crashReporting';
import { fillEmailForm } from '@/test/emailForm';

// Logs and analytics privacy check, through the screens (Forge card). Every
// flow runs the real routes and the real app logger in mock mode. The
// console (what Metro, Xcode and the device log show), a log sink and a
// crash-report transport are captured, and none may hold the email, the
// password, a room code, an invite token, a search query or a song.
// src/services/privacyLogs.test.ts covers the live services the same way.
jest.setTimeout(60_000);

jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));

const EMAIL = 'canary.screen@example.com';
const PASSWORD = 'Canary-Screen-Pa55';
const WRONG_CODE = 'K7CN4R';
const HOSTED = 'QD-7K4F9X';
const JOINED = 'QD-9M2XR4';
const QUERY = 'velvet canary';

let entries: LogEntry[];
let consoleOutput: unknown[][];
let crashEvents: CrashEvent[];
let removeSink: () => void;
let invites: RoomInvite[];

beforeEach(() => {
  entries = [];
  consoleOutput = [];
  crashEvents = [];
  invites = [];
  removeSink = addLogSink((entry) => entries.push(entry));
  setCrashTransport((event) => void crashEvents.push(event));
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(console, method).mockImplementation((...args) => void consoleOutput.push(args));
  }
  const create = MockRoomServer.prototype.createRoomInvite;
  jest.spyOn(MockRoomServer.prototype, 'createRoomInvite').mockImplementation(async function (
    this: MockRoomServer,
    input,
  ) {
    const result = await create.call(this, input);
    if (result.ok) invites.push(result.value);
    return result;
  });
});

afterEach(() => {
  removeSink();
  setCrashTransport(null);
  jest.restoreAllMocks();
});

const press = async (label: string) => {
  await act(async () => {
    fireEvent.press(await screen.findByLabelText(label));
  });
};

const typeCode = async (text: string) => {
  await act(async () => {
    fireEvent.changeText(await screen.findByLabelText('Room code'), text);
  });
};

const signIn = async () => {
  await renderRouter('./app', { initialUrl: '/sign-in' });
  await fillEmailForm({ email: EMAIL, password: PASSWORD });
  await press('Sign in');
  await screen.findByText('Start a room or jump into one.');
};

function expectNoCanary(extra: readonly string[] = []) {
  const text = JSON.stringify({ entries, consoleOutput, crashEvents });
  const canaries = [EMAIL, 'canary.screen', PASSWORD, WRONG_CODE, HOSTED, JOINED, '7K4F9X'];
  const leaked = [...canaries, QUERY, ...extra].filter((canary) => text.includes(canary));
  expect(leaked).toEqual([]);
}

it('signing in with an email and password logs neither', async () => {
  await signIn();
  expectNoCanary();
});

it('joining: a wrong code until rate limited, then a real one', async () => {
  await signIn();
  for (let i = 0; i < 6; i += 1) {
    await typeCode(WRONG_CODE);
    await press('Join');
  }
  expect(await screen.findByText(/Too many tries/)).toBeVisible();
  // The pause ends; a real code opens the room.
  jest.setSystemTime(Date.now() + 10 * 60_000);
  await typeCode(JOINED);
  await press('Join');
  expect(screen).toHavePathname(`/room/${JOINED}`);
  expectNoCanary();
});

it('inviting: the QR link, copying and sharing it, and opening it', async () => {
  jest.spyOn(Share, 'share').mockRejectedValue(new Error(`share failed for ${HOSTED}`));
  await signIn();
  await act(async () => {
    router.push({ pathname: '/room/[code]/invite', params: { code: HOSTED } });
  });
  await screen.findByLabelText('QR code with the invite link');
  await press('Copy link');
  await press('Share');
  expect(invites.length).toBeGreaterThan(0);
  const tokens = invites.map((invite) => invite.token);
  await act(async () => {
    router.push(`/join?invite=${tokens[0]}`);
  });
  await act(async () => {
    router.push('/join?invite=Cn4ryInv1teT0kenAbCdEfGhIjKlMnOpQrStUvWxYz0');
  });
  expect(await screen.findByText(/invite|link/i)).toBeVisible();
  expectNoCanary([...tokens, 'Cn4ryInv1teT0kenAbCdEfGhIjKlMnOpQrStUvWxYz0']);
});

it('searching and adding a song logs neither the query nor the song', async () => {
  await signIn();
  await act(async () => {
    router.push({ pathname: '/room/[code]', params: { code: JOINED } });
  });
  await press('Add a song');
  await screen.findByText('Rain Down');
  await act(async () => {
    fireEvent.changeText(screen.getByLabelText('Search'), QUERY);
  });
  await act(async () => {
    fireEvent.changeText(screen.getByLabelText('Search'), 'rain');
  });
  await press('Add Rain Down');
  expect(screen.getByText(/Rain Down added/)).toBeVisible();
  expectNoCanary(['Rain Down', 'Daniel Caesar', 'Son of Spergy']);
});
