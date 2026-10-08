'use client';

import type { Filters, MemberView } from '@mnm/shared';
import { Link2, Share2 } from 'lucide-react';
import { useState } from 'react';
import { GENRES, LANGUAGES, PROVIDERS } from '@/lib/catalog';
import { MarqueeButton } from './cinema/MarqueeButton';
import { MemberOrb } from './cinema/MemberOrb';
import { ReelLoader } from './cinema/ReelLoader';
import { SplitFlap } from './cinema/SplitFlap';
import { Ticket } from './cinema/Ticket';

type Props = { code: string; members: MemberView[]; filters: Filters; isHost: boolean; onStart: () => Promise<void> };

function describeFilters({ genres, language, providers }: Filters): string {
  const genreNames = GENRES.filter((g) => genres.includes(g.id)).map((g) => g.name);
  const languageName = LANGUAGES.find((l) => l.code === language)?.name;
  const providerNames = PROVIDERS.filter((p) => providers.includes(p.id)).map((p) => p.name);
  const what = genreNames.length ? genreNames.join(', ') : 'Any genre';
  const inLanguage = languageName ? ` in ${languageName}` : '';
  const where = providerNames.length ? `, on ${providerNames.join(' or ')}` : '';
  return `${what}${inLanguage}${where}`;
}

export function Lobby({ code, members, filters, isHost, onStart }: Props) {
  const [isStarting, setIsStarting] = useState(false);
  const [copyLabel, setCopyLabel] = useState('Copy invite link');
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopyLabel('Link copied');
    } catch {
      setCopyLabel(window.location.href); // clipboard blocked: show the link so it can be copied by hand
    }
  }

  async function share() {
    try {
      await navigator.share({ title: 'Movie Night', text: `Join my movie night, room ${code}`, url: window.location.href });
    } catch {
      // the share sheet was dismissed; nothing to do
    }
  }

  async function start() {
    setIsStarting(true);
    await onStart();
    setIsStarting(false);
  }

  return (
    <section className="flex flex-col items-center gap-9">
      <Ticket className="w-full" stub={<><span>Room code</span><span>{members.length} in the room</span></>}>
        <SplitFlap code={code} />
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button type="button" onClick={copyInvite} className="inline-flex max-w-full items-center gap-2 rounded-full bg-velvet px-4 py-2 text-sm font-medium break-all text-tungsten hover:bg-curtain">
            <Link2 aria-hidden className="size-4 shrink-0" />
            {copyLabel}
          </button>
          {canShare && (
            <button type="button" onClick={share} className="inline-flex items-center gap-2 rounded-full border border-velvet/30 px-4 py-2 text-sm font-medium text-paper-ink hover:border-velvet">
              <Share2 aria-hidden className="size-4" />
              Share
            </button>
          )}
        </div>
        <p className="mt-5 text-center text-sm text-paper-ink/70">Tonight: {describeFilters(filters)}</p>
      </Ticket>

      <div className="w-full">
        <h2 className="text-center font-display text-3xl font-bold text-tungsten">Who&apos;s here</h2>
        <ul aria-label="Members" className="mt-5 flex flex-wrap justify-center gap-6">
          {members.map((m) => (
            <li key={m.id}>
              <MemberOrb member={m} />
            </li>
          ))}
        </ul>
      </div>

      {isHost ? (
        <div className="flex flex-col items-center gap-2">
          <MarqueeButton type="button" onClick={start} disabled={isStarting} className="px-10 text-2xl">
            {isStarting ? 'Loading movies…' : 'Start swiping'}
          </MarqueeButton>
          <p className="text-xs text-cream/50">Start once everyone&apos;s in. Late friends can still join.</p>
        </div>
      ) : (
        <p className="flex items-center gap-3 text-cream/70">
          <ReelLoader className="size-6" />
          Waiting for the host to start…
        </p>
      )}
    </section>
  );
}
