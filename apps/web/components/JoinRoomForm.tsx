'use client';

import { RoomCodeSchema } from '@mnm/shared';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { MarqueeButton } from './cinema/MarqueeButton';
import { Ticket } from './cinema/Ticket';
import { TextField } from './TextField';

type Props = { initialCode?: string; onJoined: (code: string, token: string) => void };

export function JoinRoomForm({ initialCode = '', onJoined }: Props) {
  const [code, setCode] = useState(initialCode);
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = RoomCodeSchema.safeParse(code);
    if (!parsed.success) {
      setError('Room codes are 6 letters or digits');
      return;
    }
    setIsBusy(true);
    setError(null);
    try {
      const { token } = await api.joinRoom(parsed.data, nickname);
      onJoined(parsed.data, token);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
      setIsBusy(false);
    }
  }

  return (
    <Ticket stub={<><span>Admit one</span><span>Guest</span></>}>
      <form aria-label="Join a room" onSubmit={onSubmit} className="space-y-5">
        <div>
          <h2 className="font-display text-4xl font-extrabold leading-none text-paper-ink">
            {initialCode ? 'You’re invited' : 'Join a room'}
          </h2>
          <p className="mt-1 text-sm text-paper-ink/65">
            {initialCode ? 'Pick a nickname and grab your seat.' : 'Got a code from a friend? Pop it in.'}
          </p>
        </div>
        {initialCode ? (
          <p className="rounded-xl bg-velvet py-3 text-center font-display text-4xl font-extrabold tracking-[0.3em] text-tungsten">
            {initialCode}
          </p>
        ) : (
          <TextField
            label="Room code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={6}
            autoCapitalize="characters"
            autoComplete="off"
            placeholder="ABC234"
            className="text-center font-display text-3xl font-extrabold tracking-[0.3em] uppercase"
            required
          />
        )}
        <TextField label="Your nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={24} required placeholder="Ben" />
        {error && (
          <p role="alert" className="rounded-lg bg-exit/10 px-3 py-2 text-sm font-medium text-[#a3242a]">
            {error}
          </p>
        )}
        <MarqueeButton type="submit" tone="ink" disabled={isBusy} className="w-full">
          {isBusy ? 'Joining…' : 'Join room'}
        </MarqueeButton>
      </form>
    </Ticket>
  );
}
