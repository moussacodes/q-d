/** 225000 → "3:45". Negative values are clamped to 0. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(Math.max(ms, 0) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** "3:45" → 225000. */
export function parseDuration(text: string): number {
  const [minutes = 0, seconds = 0] = text.split(':').map(Number);
  return (minutes * 60 + seconds) * 1000;
}
