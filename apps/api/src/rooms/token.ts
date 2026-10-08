import { jwtVerify, SignJWT } from 'jose';
import { AppError } from '../errors';

const TOKEN_TTL = '24h';

export type SessionClaims = { memberId: string; roomId: string };

export type TokenService = {
  sign(claims: SessionClaims): Promise<string>;
  verify(token: string): Promise<SessionClaims>;
};

export function createTokenService(secret: string): TokenService {
  const key = new TextEncoder().encode(secret);

  return {
    sign: ({ memberId, roomId }) =>
      new SignJWT({ roomId })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(memberId)
        .setIssuedAt()
        .setExpirationTime(TOKEN_TTL)
        .sign(key),

    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
        if (typeof payload.sub !== 'string' || typeof payload.roomId !== 'string') {
          throw new Error('token is missing session claims');
        }
        return { memberId: payload.sub, roomId: payload.roomId };
      } catch {
        throw new AppError(401, 'UNAUTHORIZED', 'Invalid or expired session');
      }
    },
  };
}
