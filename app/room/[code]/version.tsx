import { useLocalSearchParams } from 'expo-router';

import type { RoomView } from '@/features/room/useRoom';
import { WrongVersionSheet } from '@/features/room/WrongVersionSheet';

/** "Wrong version?": the host picks the version of a song to play (PRODUCT_SPEC.md §6, rule 8). */
export default function WrongVersion() {
  const params = useLocalSearchParams<{ code: string; view?: RoomView; entry?: string }>();
  return <WrongVersionSheet code={params.code} view={params.view} entryId={params.entry} />;
}
