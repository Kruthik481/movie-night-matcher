'use client';

import { useRouter } from 'next/navigation';
import { CreateRoomForm } from '@/components/CreateRoomForm';
import { JoinRoomForm } from '@/components/JoinRoomForm';
import { saveSession } from '@/lib/session';

export default function Home() {
  const router = useRouter();

  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <header className="max-w-xl">
        <h1 className="text-4xl font-semibold tracking-tight">Movie Night Matcher</h1>
        <p className="mt-3 text-zinc-400">Swipe together. The first movie everyone likes wins.</p>
      </header>
      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <CreateRoomForm />
        <JoinRoomForm
          onJoined={(code, token) => {
            saveSession(code, token);
            router.push(`/room/${code}`);
          }}
        />
      </div>
    </main>
  );
}
