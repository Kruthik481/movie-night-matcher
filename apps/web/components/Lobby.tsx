'use client';

import type { MemberView } from '@mnm/shared';
import { useState } from 'react';

type Props = { code: string; members: MemberView[]; isHost: boolean; onStart: () => Promise<void> };

export function Lobby({ code, members, isHost, onStart }: Props) {
  const [isStarting, setIsStarting] = useState(false);
  const [copyLabel, setCopyLabel] = useState('Copy invite link');

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyLabel('Link copied');
    } catch {
      setCopyLabel(window.location.href); // clipboard blocked: show the link so it can be copied by hand
    }
  }

  async function start() {
    setIsStarting(true);
    await onStart();
    setIsStarting(false);
  }

  return (
    <section className="space-y-8 text-center">
      <div>
        <p className="text-sm text-zinc-400">Room code</p>
        <p className="mt-1 font-mono text-5xl font-semibold tracking-[0.3em]">{code}</p>
        <button type="button" onClick={copyInvite} className="mt-3 break-all text-sm text-amber-400 hover:underline">
          {copyLabel}
        </button>
      </div>
      <ul aria-label="Members" className="mx-auto max-w-xs space-y-2 text-left">
        {members.map((m) => (
          <li key={m.id} className="flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-2">
            <span aria-hidden className={`size-2 rounded-full ${m.isActive ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
            <span>{m.nickname}</span>
            {m.isHost && <span className="ml-auto text-xs text-zinc-500">host</span>}
          </li>
        ))}
      </ul>
      {isHost ? (
        <button
          type="button"
          onClick={start}
          disabled={isStarting}
          className="rounded-lg bg-amber-400 px-6 py-2.5 font-medium text-zinc-950 hover:bg-amber-300 disabled:opacity-60"
        >
          {isStarting ? 'Loading movies…' : 'Start swiping'}
        </button>
      ) : (
        <p className="text-zinc-400">Waiting for the host to start…</p>
      )}
    </section>
  );
}
