import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createTokenService } from '../src/rooms/token';

const SECRET = 's'.repeat(32);
const claims = { memberId: 'member-1', roomId: 'room-1' };

describe('token service', () => {
  it('round-trips session claims', async () => {
    const tokens = createTokenService(SECRET);
    expect(await tokens.verify(await tokens.sign(claims))).toEqual(claims);
  });

  it('rejects a token signed with another secret', async () => {
    const token = await createTokenService('o'.repeat(32)).sign(claims);
    await expect(createTokenService(SECRET).verify(token)).rejects.toMatchObject({
      status: 401,
      code: 'UNAUTHORIZED',
    });
  });

  it('rejects garbage', async () => {
    await expect(createTokenService(SECRET).verify('not-a-jwt')).rejects.toMatchObject({ status: 401 });
  });

  it('rejects an expired token', async () => {
    const expired = await new SignJWT({ roomId: 'room-1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('member-1')
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(SECRET));
    await expect(createTokenService(SECRET).verify(expired)).rejects.toMatchObject({ status: 401 });
  });

  it('rejects a token missing the room claim', async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('member-1')
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    await expect(createTokenService(SECRET).verify(token)).rejects.toMatchObject({ status: 401 });
  });
});
