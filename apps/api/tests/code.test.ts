import { RoomCodeSchema } from '@mnm/shared';
import { describe, expect, it } from 'vitest';
import { generateRoomCode } from '../src/rooms/code';

describe('generateRoomCode', () => {
  it('always produces a code the shared schema accepts', () => {
    for (let i = 0; i < 500; i++) {
      const code = generateRoomCode();
      expect(RoomCodeSchema.parse(code)).toBe(code);
    }
  });

  it('maps picks onto the alphabet', () => {
    expect(generateRoomCode(() => 0)).toBe('AAAAAA');
    expect(generateRoomCode((max) => max - 1)).toBe('999999');
  });
});
