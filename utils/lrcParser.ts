import type { LyricLine } from '../types.ts';

export const parseLrc = (lrcContent: string): LyricLine[] => {
  const lines = lrcContent.split('\n');
  const result: LyricLine[] = [];
  
  // Regex to match [mm:ss.xx] or [mm:ss:xx]
  const timeReg = /\[(\d{2}):(\d{2})[.:](\d{2,3})\]/;

  for (const line of lines) {
    const match = timeReg.exec(line);
    if (match) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const milliseconds = parseInt(match[3], 10);
      
      // Calculate total time in seconds
      // If ms is 2 digits, it's usually 1/100s. If 3, it's 1/1000s.
      // Standard LRC is usually 2 digits (centiseconds).
      const msDivisor = match[3].length === 3 ? 1000 : 100;
      const totalSeconds = minutes * 60 + seconds + milliseconds / msDivisor;

      const text = line.replace(timeReg, '').trim();

      if (text) {
        result.push({
          time: totalSeconds,
          text: text
        });
      }
    }
  }

  // Sort by time just in case
  return result.sort((a, b) => a.time - b.time);
};