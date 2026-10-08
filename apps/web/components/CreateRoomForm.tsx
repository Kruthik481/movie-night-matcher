'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { GENRES, LANGUAGES, PROVIDERS } from '@/lib/catalog';
import { saveSession } from '@/lib/session';
import { ChipGroup } from './ChipGroup';
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
    <form aria-label="Start a room" onSubmit={onSubmit} className="space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
      <h2 className="text-xl font-semibold">Start a room</h2>
      <TextField label="Your nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={24} required />
      <ChipGroup label="Genres (leave empty for any)" options={GENRES} selected={genres} onChange={setGenres} />
      <label className="block">
        <span className="mb-1.5 block text-sm text-zinc-400">Language</span>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2"
        >
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <ChipGroup label="Only on (leave empty for anywhere)" options={PROVIDERS} selected={providers} onChange={setProviders} />
      {error && (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={isBusy}
        className="w-full rounded-lg bg-amber-400 py-2.5 font-medium text-zinc-950 transition hover:bg-amber-300 disabled:opacity-60"
      >
        {isBusy ? 'Creating…' : 'Create room'}
      </button>
    </form>
  );
}
