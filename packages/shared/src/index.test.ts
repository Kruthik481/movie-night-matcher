import { describe, expect, it } from 'vitest';
import {
  CreateRoomBodySchema,
  FiltersSchema,
  NicknameSchema,
  RegionSchema,
  RoomCodeSchema,
  SwipeEventSchema,
} from './index';

describe('RoomCodeSchema', () => {
  it('normalizes lowercase and whitespace to the canonical code', () => {
    expect(RoomCodeSchema.parse('  ab3xyz ')).toBe('AB3XYZ');
  });

  it('rejects ambiguous characters I, O, 0 and 1', () => {
    for (const code of ['ABCDEI', 'ABCDEO', 'ABCDE0', 'ABCDE1']) {
      expect(RoomCodeSchema.safeParse(code).success).toBe(false);
    }
  });

  it('rejects codes of the wrong length', () => {
    expect(RoomCodeSchema.safeParse('ABCDE').success).toBe(false);
    expect(RoomCodeSchema.safeParse('ABCDEFG').success).toBe(false);
  });
});

describe('NicknameSchema', () => {
  it('trims and enforces 1-24 characters', () => {
    expect(NicknameSchema.parse('  ana  ')).toBe('ana');
    expect(NicknameSchema.safeParse('   ').success).toBe(false);
    expect(NicknameSchema.safeParse('x'.repeat(25)).success).toBe(false);
  });
});

describe('FiltersSchema', () => {
  it('fills defaults for an empty object', () => {
    expect(FiltersSchema.parse({})).toEqual({ genres: [], providers: [] });
  });

  it('rejects a language that is not a 2-letter ISO code', () => {
    expect(FiltersSchema.safeParse({ language: 'hindi' }).success).toBe(false);
  });
});

describe('CreateRoomBodySchema', () => {
  it('defaults filters when omitted', () => {
    expect(CreateRoomBodySchema.parse({ nickname: 'ana' })).toEqual({
      nickname: 'ana',
      filters: { genres: [], providers: [] },
    });
  });
});

describe('SwipeEventSchema', () => {
  it('requires a positive integer movie id and a boolean', () => {
    expect(SwipeEventSchema.safeParse({ movieId: 12, liked: true }).success).toBe(true);
    expect(SwipeEventSchema.safeParse({ movieId: 1.5, liked: true }).success).toBe(false);
    expect(SwipeEventSchema.safeParse({ movieId: 12, liked: 'yes' }).success).toBe(false);
  });
});

describe('RegionSchema', () => {
  it('accepts uppercase ISO 3166 codes only', () => {
    expect(RegionSchema.safeParse('IN').success).toBe(true);
    expect(RegionSchema.safeParse('in').success).toBe(false);
  });
});
