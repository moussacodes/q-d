import { MAX_ROOM_NAME_LENGTH, type RoomNameProblem } from '@/domain/room-name';
import type { RpcCallError } from '@/domain/rpc-error';

const seconds = (n: number) => (n === 1 ? '1 second' : `${n} seconds`);

/** No answer from q’d's server: offline or timed out. Retrying sends the same request. */
export const networkMessage = 'Can’t reach q’d. Check your connection, then try again.';

/**
 * What Home says when `join_room_by_code` fails. A wrong code and an expired
 * one get the same words, because the server can't tell them apart either
 * (`code_invalid`, so codes can't be probed).
 */
export function joinErrorMessage(error: RpcCallError): string {
  switch (error.code) {
    case 'code_invalid':
      return 'That code doesn’t match a room. It may be mistyped or expired, so check it with the host.';
    case 'room_full':
      return 'That room is full. Rooms hold up to 15 people.';
    case 'room_ended':
      return 'That room has ended. Ask the host for a new code.';
    case 'rate_limited':
      return `Too many tries. Wait ${seconds(error.retryAfterSeconds)}, then try again.`;
    case 'profile_incomplete':
      return 'Finish your profile before joining a room.';
    case 'not_authenticated':
      return 'Sign in again to join a room.';
    case 'network':
      return networkMessage;
    default:
      return 'Couldn’t join right now. Try again.';
  }
}

/** What Start a room says when `create_room` fails. */
export function createRoomErrorMessage(error: RpcCallError): string {
  switch (error.code) {
    case 'provider_required':
      return 'Connect a music service to start a room.';
    case 'profile_incomplete':
      return 'Finish your profile before starting a room.';
    case 'invalid_input':
      return `Room names need 1 to ${MAX_ROOM_NAME_LENGTH} characters.`;
    case 'rate_limited':
      return `Too many tries. Wait ${seconds(error.retryAfterSeconds)}, then try again.`;
    case 'network':
      return networkMessage;
    default:
      return 'Couldn’t start the room right now. Try again.';
  }
}

/** Under the Room name field. */
export function roomNameMessage(problem: RoomNameProblem): string {
  return problem === 'blank'
    ? 'Give the room a name.'
    : `Room names can be up to ${MAX_ROOM_NAME_LENGTH} characters.`;
}

/** Under the code field when it holds characters no code uses. */
export const lookalikeMessage = 'Room codes don’t use 0, O, 1 or I. Check the code with the host.';

/** What the invite link screen says when `join_room_by_invite` fails. */
export function inviteJoinErrorMessage(error: RpcCallError): string {
  switch (error.code) {
    case 'invite_invalid':
      return 'This invite doesn’t work anymore. It may have expired, or the host made a new one. Ask the host for a new link or the room code.';
    case 'room_full':
    case 'room_ended':
    case 'rate_limited':
    case 'profile_incomplete':
    case 'not_authenticated':
    case 'network':
      return joinErrorMessage(error);
    default:
      return 'Couldn’t join right now. Try again.';
  }
}

/** What Invite says when `create_room_invite` fails. */
export function createInviteErrorMessage(error: RpcCallError): string {
  if (error.code === 'not_host') return 'Only the host can invite people.';
  if (error.code === 'network') return networkMessage;
  return 'Couldn’t make an invite link. Try again.';
}
