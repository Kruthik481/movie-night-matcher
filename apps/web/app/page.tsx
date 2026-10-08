'use client';

import { useRouter } from 'next/navigation';
import { Marquee } from '@/components/cinema/Marquee';
import { ProjectorBeams } from '@/components/cinema/ProjectorBeams';
import { CreateRoomForm } from '@/components/CreateRoomForm';
import { JoinRoomForm } from '@/components/JoinRoomForm';
import { saveSession } from '@/lib/session';

const STEPS = [
  { title: 'Pick the vibe', body: 'Choose genres, a language and the services you pay for.' },
  { title: 'Swipe together', body: 'Everyone gets the same deck, live, on their own phone.' },
  { title: 'Watch the match', body: 'The first movie you all like wins, with where to stream it.' },
];

export default function Home() {
  const router = useRouter();

  return (
    <main className="relative isolate mx-auto max-w-6xl px-4 pt-8 pb-16 sm:pt-14">
      <ProjectorBeams />
      <Marquee title="Movie Night" tagline="Swipe through movies with friends. The first one everyone likes is what you watch tonight." />

      <div className="mx-auto mt-12 grid max-w-5xl items-start gap-6 lg:grid-cols-[1.4fr_1fr]">
        <CreateRoomForm />
        <JoinRoomForm
          onJoined={(code, token) => {
            saveSession(code, token);
            router.push(`/room/${code}`);
          }}
        />
      </div>

      <ol className="mx-auto mt-16 grid max-w-5xl gap-6 sm:grid-cols-3">
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex gap-4">
            <span className="font-display text-5xl leading-none font-extrabold text-marquee/80">{i + 1}</span>
            <div>
              <h2 className="font-display text-2xl font-bold text-tungsten">{step.title}</h2>
              <p className="mt-1 text-sm text-cream/70">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </main>
  );
}
