'use client';

import dynamic from 'next/dynamic';
import { useParams } from 'next/navigation';

const RoomClient = dynamic(() => import('@/components/RoomClient'), { ssr: false });

export default function RoomPage() {
  const { code } = useParams<{ code: string }>();
  return <RoomClient code={code.toUpperCase()} />;
}
