export interface LyricLine {
  time: number; // Time in seconds
  text: string;
}

export interface AppSettings {
  primaryColor: string; // Hex code for active lyric
  secondaryColor: string; // Hex code for inactive lyric
  backgroundColor: string; // Hex code for background
  fontSize: number;
  glowIntensity: number; // 0 to 50
  lyricsXOffset: number; // Percentage 0-100 (default 45)
  introDuration: number; // Seconds (default 3)
  songTitle: string;     // Title text
  videoWidth: number;
  videoHeight: number;
  
  // Bokeh Settings
  bokehEnabled: boolean;
  bokehAutoColor: boolean;
  bokehColor: string;
  bokehAutoSize: boolean;
  bokehScale: number; // 0 to 100
}

export interface MediaState {
  audioUrl: string | null;
  imageUrl: string | null;
  lyrics: LyricLine[];
  fileName: string; // Base name for export
}