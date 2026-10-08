'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { GENRES, LANGUAGES, PROVIDERS } from '@/lib/catalog';
import { saveSession } from '@/lib/session';
import { ChipGroup } from './ChipGroup';
import { MarqueeButton } from './cinema/MarqueeButton';
import { Ticket } from './cinema/Ticket';
import { TextField } from './TextField';

export function CreateRoomForm() {
  const router = useRouter();
  const [nickname, setNickname] = useState('');
  const [genres, setGenres] = useState<number[]>([]);
  const [language, setLanguage] = useState('');
  const [providers, setProviders] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setIsBusy(true);
    setError(null);
    try {
      const { code, token } = await api.createRoom(nickname, { genres, providers, ...(language ? { language } : {}) });
      saveSession(code, token);
      router.push(`/room/${code}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
      setIsBusy(false);
    }
  }

  return (
    <Ticket stub={<><span>Admit one</span><span>Host</span></>}>
      <form aria-label="Start a room" onSubmit={onSubmit} className="space-y-5">
        <div>
          <h2 className="font-display text-4xl font-extrabold leading-none text-paper-ink">Start a room</h2>
          <p className="mt-1 text-sm text-paper-ink/65">Set tonight&apos;s mood, then share the code with your friends.</p>
        </div>
        <TextField label="Your nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={24} required placeholder="Kruthik" />
        <ChipGroup label="Genres (leave empty for any)" options={GENRES} selected={genres} onChange={setGenres} />
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-paper-ink/70">Language</span>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="w-full rounded-xl border border-paper-ink/20 bg-white/45 px-4 py-3 text-paper-ink outline-none focus:border-curtain focus:ring-2 focus:ring-marquee/60"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <ChipGroup label="Only on (leave empty for anywhere)" options={PROVIDERS} selected={providers} onChange={setProviders} />
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-exit/10 px-3 py-2 text-sm font-medium text-[#a3242a]">
            {error}
          </p>
        )}
        <MarqueeButton type="submit" tone="ink" disabled={isBusy} className="w-full">
          {isBusy ? 'Creating…' : 'Create room'}
        </MarqueeButton>
      </form>
    </Ticket>
  );
}
