'use client';

import { useState } from 'react';
import { loadSession, saveSession } from '@/lib/session';
import { ProjectorBeams } from './cinema/ProjectorBeams';
import { JoinRoomForm } from './JoinRoomForm';
import { RoomScreen } from './RoomScreen';

export default function RoomClient({ code }: { code: string }) {
  const [token, setToken] = useState<string | null>(() => loadSession(code));

  if (!token) {
    return (
      <main className="relative isolate mx-auto max-w-md px-4 py-14">
        <ProjectorBeams />
        <JoinRoomForm
          initialCode={code}
          onJoined={(joinedCode, joinedToken) => {
            saveSession(joinedCode, joinedToken);
            setToken(joinedToken);
          }}
        />
      </main>
    );
  }
  return <RoomScreen code={code} token={token} />;
}
