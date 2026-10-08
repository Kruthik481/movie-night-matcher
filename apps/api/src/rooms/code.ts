import { randomInt } from 'node:crypto';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@mnm/shared';

export function generateRoomCode(pick: (max: number) => number = randomInt): string {
  return Array.from(
    { length: ROOM_CODE_LENGTH },
    () => ROOM_CODE_ALPHABET[pick(ROOM_CODE_ALPHABET.length)],
  ).join('');
}
