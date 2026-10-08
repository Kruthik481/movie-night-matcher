'use client';

import { RoomCodeSchema } from '@mnm/shared';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
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
    <form aria-label="Join a room" onSubmit={onSubmit} className="space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
      <h2 className="text-xl font-semibold">Join a room</h2>
      {initialCode ? (
        <p className="text-sm text-zinc-400">
          Room <span className="font-mono text-zinc-100">{initialCode}</span>
        </p>
      ) : (
        <TextField
          label="Room code"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          maxLength={6}
          autoCapitalize="characters"
          className="font-mono uppercase tracking-widest"
          required
        />
      )}
      <TextField label="Your nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={24} required />
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={isBusy}
        className="w-full rounded-lg border border-amber-400 py-2.5 font-medium text-amber-400 transition hover:bg-amber-400/10 disabled:opacity-60"
      >
        {isBusy ? 'Joining…' : 'Join room'}
      </button>
    </form>
  );
}
