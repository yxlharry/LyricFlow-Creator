import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { Upload, Music, Image as ImageIcon, FileText, Play, Pause, Download, MonitorPlay, Settings, AlignLeft, Sun, Sparkles } from 'lucide-react';

// --- TYPES ---

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

// --- UTILS: LRC PARSER ---

const parseLrc = (lrcContent: string): LyricLine[] => {
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

// --- UTILS: RENDERER ---

interface RenderContext {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  image: HTMLImageElement | null;
  lyrics: LyricLine[];
  currentTime: number;
  smoothActiveIndex: number;
  absoluteTime: number; // Monotonic time for animations independent of audio
  isIntro: boolean;
  titleOpacity: number; // 0 to 1
  lyricsOpacity: number; // 0 to 1
  settings: AppSettings;
}

// Helper to convert hex to RGB object
function hexToRgb(hex: string) {
  const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  hex = hex.replace(shorthandRegex, (m, r, g, b) => {
    return r + r + g + g + b + b;
  });

  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 255, g: 255, b: 255 };
}

// Color interpolation
function interpolateColor(color1: string, color2: string, factor: number) {
    const c1 = hexToRgb(color1);
    const c2 = hexToRgb(color2);
    const f = Math.max(0, Math.min(1, factor));
    const r = Math.round(c1.r + (c2.r - c1.r) * f);
    const g = Math.round(c1.g + (c2.g - c1.g) * f);
    const b = Math.round(c1.b + (c2.b - c1.b) * f);
    return `rgb(${r}, ${g}, ${b})`;
}

// Helper to wrap text into lines based on maxWidth
function getWrappedLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = words[0];

    for (let i = 1; i < words.length; i++) {
        const word = words[i];
        const width = ctx.measureText(currentLine + " " + word).width;
        if (width < maxWidth) {
            currentLine += " " + word;
        } else {
            lines.push(currentLine);
            currentLine = word;
        }
    }
    lines.push(currentLine);
    return lines;
}

/**
 * Draws a rounded rectangle image
 */
function drawRoundedImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.closePath();
  ctx.clip();
  
  // Draw image covering the area
  const imgRatio = img.width / img.height;
  const areaRatio = width / height;
  
  let drawWidth, drawHeight, offsetX, offsetY;
  
  if (imgRatio > areaRatio) {
    drawHeight = height;
    drawWidth = height * imgRatio;
    offsetX = x - (drawWidth - width) / 2;
    offsetY = y;
  } else {
    drawWidth = width;
    drawHeight = width / imgRatio;
    offsetX = x;
    offsetY = y - (drawHeight - height) / 2;
  }

  ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
  ctx.restore();
  
  // Border
  ctx.save();
  ctx.beginPath();
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.roundRect(x, y, width, height, radius);
  ctx.stroke();
  ctx.restore();
}

/**
 * Procedurally draws floating bokeh spots
 */
function drawBokeh(ctx: CanvasRenderingContext2D, width: number, height: number, time: number, settings: AppSettings) {
    ctx.save();
    // Use 'screen' or 'lighter' for that dreamy light-addition effect
    ctx.globalCompositeOperation = 'screen';
    
    // Number of particles
    const particleCount = 15;
    
    for (let i = 0; i < particleCount; i++) {
        // Deterministic randomness based on index
        const randomBase = (i * 1337) % 1000; 
        
        // Speed variation
        const speed = 0.0002 + (randomBase % 100) * 0.00001;
        
        // Movement logic: Sine waves for smooth floating
        const t = time * speed + randomBase;
        
        // Position: Bias towards edges
        const side = i % 2 === 0 ? -1 : 1; // Left or Right bias
        const xBase = width / 2 + (width / 2.5) * side; 
        const xOffset = Math.sin(t) * (width * 0.2);
        const x = xBase + xOffset;
        
        const yBase = height * (0.2 + ((randomBase % 10) / 10) * 0.8); // Spread vertically
        const yOffset = Math.cos(t * 1.3) * (height * 0.15);
        const y = yBase + yOffset;

        // Size
        let radius = 100;
        if (settings.bokehAutoSize) {
            // Oscillate size
            radius = 150 + Math.sin(t * 2) * 80 + (randomBase % 100);
        } else {
            // Fixed base size + slight oscillation
            const baseSize = 50 + (settings.bokehScale * 4); // Map 0-100 to 50-450
            radius = baseSize + Math.sin(t * 3) * 20;
        }

        // Color
        if (settings.bokehAutoColor) {
            // Placeholder logic for gradient creation below
        }

        // Create Gradient for soft spot
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        
        // Alpha calculation: Pulse in and out
        const alphaBase = 0.15;
        const alpha = alphaBase + Math.sin(t * 1.7) * 0.05;

        if (settings.bokehAutoColor) {
            const hue = (t * 50 + randomBase) % 360;
            gradient.addColorStop(0, `hsla(${hue}, 80%, 60%, ${alpha})`);
            gradient.addColorStop(1, `hsla(${hue}, 80%, 60%, 0)`);
        } else {
            const { r, g, b } = hexToRgb(settings.bokehColor);
            gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha})`);
            gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
        }

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
    }
    
    ctx.restore();
}

const renderFrame = ({
  ctx,
  width,
  height,
  image,
  lyrics,
  currentTime,
  smoothActiveIndex,
  absoluteTime,
  isIntro,
  titleOpacity,
  lyricsOpacity,
  settings,
}: RenderContext) => {
  // 1. Clear Screen
  ctx.clearRect(0, 0, width, height);

  // 2. Draw Background
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, settings.backgroundColor);
  gradient.addColorStop(1, '#020617');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // 3. Draw blurred background image layer
  if (image) {
      ctx.save();
      ctx.globalAlpha = 0.15;
      ctx.filter = 'blur(60px) saturate(150%)';
      ctx.drawImage(image, -width * 0.2, -height * 0.2, width * 1.4, height * 1.4);
      ctx.restore();
  }

  // 4. Draw Bokeh Overlay (Behind content, over background)
  if (settings.bokehEnabled) {
      drawBokeh(ctx, width, height, absoluteTime, settings);
  }

  // Layout Constants
  const leftPanelWidth = width * 0.4;
  const rightPanelStart = width * (settings.lyricsXOffset / 100); // Adjustable X
  const rightPanelWidth = width - rightPanelStart - 50; // Remaining width minus padding
  const verticalCenter = height / 2;

  // 5. Draw Album Art (Left Side)
  if (image) {
    const imgSize = Math.min(leftPanelWidth * 0.75, height * 0.55);
    const imgX = (leftPanelWidth - imgSize) / 2 + 60;
    const imgY = (height - imgSize) / 2;
    
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 20;
    
    drawRoundedImage(ctx, image, imgX, imgY, imgSize, imgSize, 24);
    ctx.restore();
  } else {
    // Placeholder
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    const imgSize = Math.min(leftPanelWidth * 0.75, height * 0.55);
    const imgX = (leftPanelWidth - imgSize) / 2 + 60;
    const imgY = (height - imgSize) / 2;
    
    ctx.beginPath();
    ctx.roundRect(imgX, imgY, imgSize, imgSize, 24);
    ctx.fill();
    
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '500 32px Inter';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No Cover Art', imgX + imgSize/2, imgY + imgSize/2);
  }

  // 6. INTRO MODE: Show Title
  if (isIntro) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      
      const titleX = rightPanelStart;
      const titleY = verticalCenter;
      
      ctx.save();
      ctx.globalAlpha = titleOpacity; // Apply Fade Out
      ctx.font = `bold ${settings.fontSize * 1.5}px Inter, sans-serif`;
      ctx.fillStyle = settings.primaryColor;
      ctx.shadowColor = settings.primaryColor;
      ctx.shadowBlur = settings.glowIntensity * 1.5;
      
      // Wrap title if needed
      const titleLines = getWrappedLines(ctx, settings.songTitle || "Unknown Track", rightPanelWidth);
      
      titleLines.forEach((line, idx) => {
          const yOff = (idx - (titleLines.length - 1) / 2) * (settings.fontSize * 1.8);
          ctx.fillText(line, titleX, titleY + yOff);
      });
      
      ctx.restore();
      return;
  }

  // 7. LYRICS MODE
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  
  const baseFontSize = settings.fontSize;
  const lineHeight = baseFontSize * 2.2;
  const maxVisibleDist = 5;

  const startIndex = Math.max(0, Math.floor(smoothActiveIndex - maxVisibleDist));
  const endIndex = Math.min(lyrics.length - 1, Math.ceil(smoothActiveIndex + maxVisibleDist));

  for (let i = startIndex; i <= endIndex; i++) {
    const line = lyrics[i];
    const distance = i - smoothActiveIndex; 
    const yPos = verticalCenter + (distance * lineHeight);
    const absDist = Math.abs(distance);
    
    // Scale Logic - Cosine easing for smoother center transition
    let scale = 1.0;
    if (absDist < 1.0) {
        // Cosine-based ease (smooth bell curve shape) to avoid sharp "point" at 0
        const ease = (1 + Math.cos(Math.PI * absDist)) / 2; // Goes from 1.0 (at 0) to 0.0 (at 1)
        scale = 1.0 + 0.15 * ease;
    }

    // Color & Alpha Logic
    let color = settings.secondaryColor;
    let alpha = 1.0;
    let blur = 0;

    if (absDist < 0.6) {
        const factor = absDist * 1.66; // Normalize 0.6 to 1.0
        color = interpolateColor(settings.primaryColor, settings.secondaryColor, factor);
    }
    
    if (absDist > 2) {
        alpha = Math.max(0, 1 - (absDist - 2) * 0.4);
    }
    
    if (absDist > 1.2) {
        blur = (absDist - 1.2) * 2;
    }

    // Apply Global Fade In for Lyrics
    alpha = alpha * lyricsOpacity;

    if (alpha <= 0.01) continue;

    ctx.save();
    ctx.translate(rightPanelStart, yPos);
    ctx.scale(scale, scale);
    
    if (blur > 0) ctx.filter = `blur(${blur}px)`;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    
    const fontWeight = absDist < 0.4 ? '700' : '600';
    ctx.font = `${fontWeight} ${baseFontSize}px Inter, sans-serif`;

    // Glow
    if (absDist < 0.4) {
        ctx.shadowColor = settings.primaryColor;
        ctx.shadowBlur = settings.glowIntensity * (1 - absDist/0.4);
    }

    // Wrapping Logic
    const wrappedLines = getWrappedLines(ctx, line.text, rightPanelWidth / scale);
    
    // Draw lines centered vertically around the logical Y line position
    const totalHeight = (wrappedLines.length - 1) * (baseFontSize * 1.1);
    const startY = -totalHeight / 2;

    wrappedLines.forEach((txt, lineIdx) => {
        const lineY = startY + (lineIdx * (baseFontSize * 1.1));
        ctx.fillText(txt, 0, lineY);
    });

    ctx.restore();
  }
};

// --- APP COMPONENT ---

// Default Settings
const DEFAULT_SETTINGS: AppSettings = {
  primaryColor: '#38bdf8', // Tailwind Sky 400
  secondaryColor: '#94a3b8', // Tailwind Slate 400
  backgroundColor: '#0f172a', // Tailwind Slate 900
  fontSize: 42,
  glowIntensity: 20,
  lyricsXOffset: 45, // 45% from left
  introDuration: 3, // Seconds
  songTitle: '',
  videoWidth: 1920,
  videoHeight: 1080,
  
  // Bokeh Defaults
  bokehEnabled: false,
  bokehAutoColor: true,
  bokehColor: '#38bdf8',
  bokehAutoSize: true,
  bokehScale: 50,
};

function App() {
  // State
  const [media, setMedia] = useState<MediaState>({
    audioUrl: null,
    imageUrl: null,
    lyrics: [],
    fileName: 'karaoke-video'
  });
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingPhase, setRecordingPhase] = useState<'idle' | 'intro' | 'recording'>('idle');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  // Refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const requestRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  
  // Audio API Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const audioDestNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const silenceOscRef = useRef<OscillatorNode | null>(null);
  
  // Animation State
  const smoothIndexRef = useRef<number>(0);
  const introStartTimeRef = useRef<number>(0); // Timestamp when intro started

  // Helpers to handle file uploads
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'audio' | 'image' | 'lrc') => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (type === 'audio') {
      const url = URL.createObjectURL(file);
      const fileName = file.name.replace(/\.[^/.]+$/, "");
      setMedia(prev => ({ ...prev, audioUrl: url, fileName }));
      setSettings(prev => ({ ...prev, songTitle: fileName })); // Default title to filename
    } else if (type === 'image') {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.src = url;
      img.onload = () => {
        imageRef.current = img;
        setMedia(prev => ({ ...prev, imageUrl: url }));
      };
    } else if (type === 'lrc') {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        const parsedLyrics = parseLrc(text);
        setMedia(prev => ({ ...prev, lyrics: parsedLyrics }));
        smoothIndexRef.current = 0;
      };
      reader.readAsText(file);
    }
  };

  // The Main Render Loop
  const animate = useCallback(() => {
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        
        // Determine Time and Intro Status
        let time = 0;
        let isIntro = false;
        
        // Transition Opacities
        let titleOpacity = 1.0;
        let lyricsOpacity = 1.0;
        const FADE_DURATION = 0.5; // Seconds

        if (recordingPhase === 'intro') {
            // In Intro Recording Mode
            isIntro = true;
            const elapsed = (Date.now() - introStartTimeRef.current) / 1000;
            
            // Fade out title at end of intro
            const remaining = settings.introDuration - elapsed;
            if (remaining < FADE_DURATION) {
                titleOpacity = Math.max(0, remaining / FADE_DURATION);
            } else {
                titleOpacity = 1.0;
            }
            lyricsOpacity = 0; // Hide lyrics

            if (elapsed > settings.introDuration) {
                 // Intro finished, start audio
                 handleIntroComplete();
                 time = 0;
                 isIntro = false;
            }
        } else if (audioRef.current) {
             // Normal Playback / Recording Mode
             time = audioRef.current.currentTime;
             setCurrentTime(time);
             
             // Fade in lyrics at start of playback if we just came from intro
             // We can check if time < FADE_DURATION
             titleOpacity = 0; // Hide title
             if (time < FADE_DURATION) {
                lyricsOpacity = Math.min(1.0, time / FADE_DURATION);
             } else {
                lyricsOpacity = 1.0;
             }
        }

        // --- Snappy Smooth Scroll Logic ---
        let activeIndex = 0;
        const lyrics = media.lyrics;
        
        for (let i = 0; i < lyrics.length; i++) {
            if (time >= lyrics[i].time) activeIndex = i;
            else break;
        }
        
        const diff = activeIndex - smoothIndexRef.current;
        const absDiff = Math.abs(diff);

        // SNAP LOGIC REFINED:
        if (absDiff > 10) {
            smoothIndexRef.current = activeIndex; // Seek snap
        } else if (absDiff < 0.001) {
            smoothIndexRef.current = activeIndex; // Micro snap
        } else {
            smoothIndexRef.current += diff * 0.1; 
        }

        renderFrame({
          ctx,
          width: settings.videoWidth,
          height: settings.videoHeight,
          image: imageRef.current,
          lyrics: media.lyrics,
          currentTime: time,
          smoothActiveIndex: smoothIndexRef.current,
          absoluteTime: performance.now(),
          isIntro,
          titleOpacity,
          lyricsOpacity,
          settings,
        });
      }
    }
    requestRef.current = requestAnimationFrame(animate);
  }, [media.lyrics, settings, recordingPhase]);

  // Handle transition from Intro -> Audio
  const handleIntroComplete = () => {
      setRecordingPhase('recording');
      if (audioRef.current) {
          audioRef.current.play().catch(console.error);
          setIsPlaying(true);
      }
  };

  // Effect: Start/Stop Animation Loop
  useEffect(() => {
    requestRef.current = requestAnimationFrame(animate);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [animate]);

  // Effect: Sync Play button with Audio element state
  useEffect(() => {
    if (recordingPhase === 'idle' && audioRef.current) {
      if (isPlaying) audioRef.current.play().catch(console.error);
      else audioRef.current.pause();
    }
  }, [isPlaying, recordingPhase]);

  // Recording Logic
  const startRecording = async () => {
    if (!canvasRef.current || !audioRef.current) return;
    
    // 1. Initialize Web Audio API to handle mixing (Intro Silence + Music)
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    const actx = audioContextRef.current;

    // 2. Resume context if suspended (browser autoplay policy)
    if (actx.state === 'suspended') {
      try { await actx.resume(); } catch (e) { console.error("Could not resume audio context", e); }
    }

    // 3. Create Destination for Recorder
    if (!audioDestNodeRef.current) {
      audioDestNodeRef.current = actx.createMediaStreamDestination();
    }
    const dest = audioDestNodeRef.current;

    // 4. Connect Audio Element (Once only)
    // We need to route the audio element through the context to the recorder AND the speakers
    if (!audioSourceNodeRef.current && audioRef.current) {
      try {
          audioSourceNodeRef.current = actx.createMediaElementSource(audioRef.current);
          audioSourceNodeRef.current.connect(dest); // To Recorder
          audioSourceNodeRef.current.connect(actx.destination); // To Speakers (Monitor)
      } catch (err) {
          console.warn("Audio node already connected or error:", err);
      }
    }

    // 5. Create Active Silence (Oscillator)
    // This is CRITICAL. MediaRecorder often pauses if the audio track is inactive (paused).
    // By playing a silent oscillator, we keep the audio clock running during the Intro phase.
    const osc = actx.createOscillator();
    const gain = actx.createGain();
    gain.gain.value = 0; // Silence
    osc.connect(gain);
    gain.connect(dest); // Connect silence to recorder stream
    osc.start();
    silenceOscRef.current = osc; // Store to stop later

    // 6. Setup Stream
    const canvasStream = canvasRef.current.captureStream(60); 
    const finalStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...dest.stream.getAudioTracks()
    ]);

    const options = { 
        mimeType: 'video/webm; codecs=vp9',
        videoBitsPerSecond: 8000000 // 8 Mbps high quality
    };
    
    try {
        const recorder = new MediaRecorder(finalStream, options);
        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.onstop = () => {
            const blob = new Blob(chunksRef.current, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            setDownloadUrl(url);
            chunksRef.current = [];
            setRecordingPhase('idle');
            setIsRecording(false);
            setIsPlaying(false);
            
            // Cleanup oscillator
            if(silenceOscRef.current) {
                try { silenceOscRef.current.stop(); } catch(e){}
                silenceOscRef.current.disconnect();
                silenceOscRef.current = null;
            }
        };

        mediaRecorderRef.current = recorder;
        chunksRef.current = [];
        recorder.start();
        setIsRecording(true);
        setDownloadUrl(null);

        // 7. Start Intro Phase
        audioRef.current.currentTime = 0;
        audioRef.current.pause();
        smoothIndexRef.current = 0;
        introStartTimeRef.current = Date.now();
        setRecordingPhase('intro');
        
    } catch (e) {
        console.error("Recording error", e);
        alert("Could not start recording. " + e);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
        if (audioRef.current) audioRef.current.pause();
    }
  };

  const togglePlay = () => {
    if (isRecording) {
        stopRecording();
    } else {
        setIsPlaying(!isPlaying);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col p-4 md:p-8">
      
      {/* Header */}
      <header className="mb-8 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-sky-400 to-indigo-400 bg-clip-text text-transparent">
            LyricFlow Creator
          </h1>
          <p className="text-slate-400 text-sm mt-1">Generate High-Quality Lyric Videos directly in browser</p>
        </div>
        
        <div className="flex gap-3">
          {downloadUrl && (
             <a 
               href={downloadUrl} 
               download={`${media.fileName}.webm`}
               className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 rounded-lg font-medium transition-colors"
             >
               <Download size={18} /> Download Video
             </a>
          )}
          
          {!isRecording ? (
             <button
                onClick={startRecording}
                disabled={!media.audioUrl || !media.lyrics.length}
                className="flex items-center gap-2 px-6 py-2.5 bg-rose-600 hover:bg-rose-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-bold transition-all shadow-lg shadow-rose-900/40 hover:scale-105 active:scale-95"
             >
                <MonitorPlay size={20} /> Record Video
             </button>
          ) : (
            <button
                onClick={stopRecording}
                className="flex items-center gap-2 px-6 py-2.5 bg-slate-800 border-2 border-rose-500 animate-pulse text-rose-500 rounded-lg font-bold"
            >
                <span className="w-3 h-3 bg-rose-500 rounded-full animate-ping"></span>
                {recordingPhase === 'intro' ? 'Recording Intro...' : 'Stop Recording'}
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col xl:flex-row gap-8">
        
        {/* Left Sidebar: Controls */}
        <div className="w-full xl:w-96 flex flex-col gap-6 order-2 xl:order-1 h-full overflow-y-auto pr-2 custom-scrollbar">
          
          {/* File Uploads */}
          <div className="bg-slate-900/50 p-6 rounded-2xl border border-slate-800 space-y-4">
             <h2 className="text-lg font-semibold text-slate-200 mb-2 flex items-center gap-2">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-800 text-xs text-sky-400">1</span>
                Assets
             </h2>
             
             {/* Audio */}
             <div className="group relative">
                <input 
                  type="file" 
                  accept="audio/wav, audio/mp3" 
                  onChange={(e) => handleFileUpload(e, 'audio')}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className={`p-4 rounded-xl border border-dashed flex items-center gap-3 transition-all ${media.audioUrl ? 'border-sky-500 bg-sky-900/20' : 'border-slate-700 hover:border-slate-500 bg-slate-900'}`}>
                   <div className={`p-2 rounded-lg transition-colors ${media.audioUrl ? 'bg-sky-500' : 'bg-slate-800 group-hover:bg-slate-700'}`}>
                      <Music size={20} className="text-white" />
                   </div>
                   <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate text-slate-200">{media.audioUrl ? 'Audio Loaded' : 'Upload Audio'}</p>
                      {media.audioUrl && <p className="text-xs text-slate-400 mt-0.5 truncate">{media.fileName}</p>}
                   </div>
                   <Upload size={16} className="text-slate-500" />
                </div>
             </div>

             {/* Image */}
             <div className="group relative">
                <input 
                  type="file" 
                  accept="image/*" 
                  onChange={(e) => handleFileUpload(e, 'image')}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className={`p-4 rounded-xl border border-dashed flex items-center gap-3 transition-all ${media.imageUrl ? 'border-sky-500 bg-sky-900/20' : 'border-slate-700 hover:border-slate-500 bg-slate-900'}`}>
                   <div className={`p-2 rounded-lg transition-colors ${media.imageUrl ? 'bg-sky-500' : 'bg-slate-800 group-hover:bg-slate-700'}`}>
                      <ImageIcon size={20} className="text-white" />
                   </div>
                   <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate text-slate-200">{media.imageUrl ? 'Cover Art Loaded' : 'Upload Cover Art'}</p>
                   </div>
                   <Upload size={16} className="text-slate-500" />
                </div>
             </div>

             {/* Lyrics */}
             <div className="group relative">
                <input 
                  type="file" 
                  accept=".lrc,.txt" 
                  onChange={(e) => handleFileUpload(e, 'lrc')}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                />
                <div className={`p-4 rounded-xl border border-dashed flex items-center gap-3 transition-all ${media.lyrics.length > 0 ? 'border-sky-500 bg-sky-900/20' : 'border-slate-700 hover:border-slate-500 bg-slate-900'}`}>
                   <div className={`p-2 rounded-lg transition-colors ${media.lyrics.length > 0 ? 'bg-sky-500' : 'bg-slate-800 group-hover:bg-slate-700'}`}>
                      <FileText size={20} className="text-white" />
                   </div>
                   <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate text-slate-200">{media.lyrics.length > 0 ? `${media.lyrics.length} lines loaded` : 'Upload Lyrics'}</p>
                   </div>
                   <Upload size={16} className="text-slate-500" />
                </div>
             </div>
          </div>

          {/* Settings */}
          <div className="bg-slate-900/50 p-6 rounded-2xl border border-slate-800 space-y-5">
             <h2 className="text-lg font-semibold text-slate-200 mb-2 flex items-center gap-2">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-slate-800 text-xs text-sky-400">2</span>
                Appearance
             </h2>
             
             {/* Song Title Input */}
             <div className="space-y-2">
                <label className="text-xs text-slate-400 uppercase font-bold tracking-wider">Song Title</label>
                <input 
                    type="text" 
                    value={settings.songTitle} 
                    onChange={(e) => setSettings({...settings, songTitle: e.target.value})}
                    placeholder="Enter Song Name"
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-500 transition-colors"
                />
             </div>

             {/* Colors */}
             <div className="space-y-2">
                <label className="text-xs text-slate-400 uppercase font-bold tracking-wider">Accent Color</label>
                <div className="flex gap-2 flex-wrap">
                   {['#38bdf8', '#f472b6', '#a78bfa', '#34d399', '#fbbf24', '#f87171', '#ffffff'].map(c => (
                     <button 
                       key={c}
                       onClick={() => setSettings({...settings, primaryColor: c})}
                       className={`w-8 h-8 rounded-full border-2 transition-all shadow-lg ${settings.primaryColor === c ? 'border-white scale-110 shadow-sky-500/20' : 'border-transparent opacity-50 hover:opacity-100 bg-slate-800'}`}
                       style={{ backgroundColor: c }}
                     />
                   ))}
                   <div className="relative w-8 h-8 rounded-full overflow-hidden border-2 border-slate-700 hover:border-slate-500 transition-colors">
                       <input 
                          type="color" 
                          value={settings.primaryColor}
                          onChange={(e) => setSettings({...settings, primaryColor: e.target.value})}
                          className="absolute inset-0 w-12 h-12 -top-2 -left-2 cursor-pointer p-0 border-0"
                       />
                   </div>
                </div>
             </div>
             
             {/* Font Size */}
             <div className="space-y-3 pt-2">
                <div className="flex justify-between items-center">
                    <label className="text-xs text-slate-400 uppercase font-bold tracking-wider flex items-center gap-2"><Settings size={12}/> Font Size</label>
                    <span className="text-xs text-slate-500 font-mono">{settings.fontSize}px</span>
                </div>
                <input 
                   type="range" min="30" max="80" 
                   value={settings.fontSize} 
                   onChange={(e) => setSettings({...settings, fontSize: Number(e.target.value)})}
                   className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-sky-500"
                />
             </div>

             {/* Glow Intensity */}
             <div className="space-y-3 pt-2">
                <div className="flex justify-between items-center">
                    <label className="text-xs text-slate-400 uppercase font-bold tracking-wider flex items-center gap-2"><Sun size={12}/> Glow Effect</label>
                    <span className="text-xs text-slate-500 font-mono">{settings.glowIntensity}%</span>
                </div>
                <input 
                   type="range" min="0" max="50" 
                   value={settings.glowIntensity} 
                   onChange={(e) => setSettings({...settings, glowIntensity: Number(e.target.value)})}
                   className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-sky-500"
                />
             </div>

             {/* Lyrics Position X */}
             <div className="space-y-3 pt-2">
                <div className="flex justify-between items-center">
                    <label className="text-xs text-slate-400 uppercase font-bold tracking-wider flex items-center gap-2"><AlignLeft size={12}/> Text Position</label>
                    <span className="text-xs text-slate-500 font-mono">{settings.lyricsXOffset}%</span>
                </div>
                <input 
                   type="range" min="30" max="70" 
                   value={settings.lyricsXOffset} 
                   onChange={(e) => setSettings({...settings, lyricsXOffset: Number(e.target.value)})}
                   className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-sky-500"
                />
             </div>

             {/* Dynamic Light Effects (Bokeh) */}
             <div className="space-y-3 pt-4 mt-4 border-t border-slate-800">
                <div className="flex justify-between items-center">
                    <label className="text-xs text-slate-400 uppercase font-bold tracking-wider flex items-center gap-2">
                        <Sparkles size={12}/> Light Effects
                    </label>
                    <button 
                        onClick={() => setSettings(s => ({...s, bokehEnabled: !s.bokehEnabled}))}
                        className={`w-10 h-5 rounded-full relative transition-colors ${settings.bokehEnabled ? 'bg-sky-500' : 'bg-slate-700'}`}
                    >
                        <span className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${settings.bokehEnabled ? 'left-6' : 'left-1'}`} />
                    </button>
                </div>
                
                {settings.bokehEnabled && (
                    <div className="bg-slate-900/50 p-3 rounded-lg space-y-3 animate-in fade-in slide-in-from-top-2">
                        {/* Bokeh Color */}
                        <div className="flex items-center justify-between">
                             <label className="text-xs text-slate-400">Color</label>
                             <div className="flex items-center gap-2">
                                 <label className="text-[10px] text-slate-500 flex items-center gap-1 cursor-pointer">
                                     <input 
                                        type="checkbox" 
                                        checked={settings.bokehAutoColor}
                                        onChange={(e) => setSettings(s => ({...s, bokehAutoColor: e.target.checked}))}
                                        className="rounded bg-slate-700 border-slate-600 text-sky-500 focus:ring-0 focus:ring-offset-0 w-3 h-3"
                                     />
                                     Auto
                                 </label>
                                 {!settings.bokehAutoColor && (
                                     <input 
                                        type="color" 
                                        value={settings.bokehColor}
                                        onChange={(e) => setSettings(s => ({...s, bokehColor: e.target.value}))}
                                        className="w-6 h-6 rounded overflow-hidden cursor-pointer border-0 p-0"
                                     />
                                 )}
                             </div>
                        </div>

                        {/* Bokeh Size */}
                        <div className="space-y-1">
                             <div className="flex items-center justify-between">
                                 <label className="text-xs text-slate-400">Size</label>
                                 <label className="text-[10px] text-slate-500 flex items-center gap-1 cursor-pointer">
                                     <input 
                                        type="checkbox" 
                                        checked={settings.bokehAutoSize}
                                        onChange={(e) => setSettings(s => ({...s, bokehAutoSize: e.target.checked}))}
                                        className="rounded bg-slate-700 border-slate-600 text-sky-500 focus:ring-0 focus:ring-offset-0 w-3 h-3"
                                     />
                                     Auto
                                 </label>
                             </div>
                             {!settings.bokehAutoSize && (
                                 <input 
                                    type="range" min="0" max="100" 
                                    value={settings.bokehScale} 
                                    onChange={(e) => setSettings({...settings, bokehScale: Number(e.target.value)})}
                                    className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-sky-500"
                                 />
                             )}
                        </div>
                    </div>
                )}
             </div>

             {/* Intro Duration */}
             <div className="space-y-3 pt-2 border-t border-slate-800 mt-4">
                <div className="flex justify-between items-center mt-4">
                    <label className="text-xs text-slate-400 uppercase font-bold tracking-wider">Intro Silence</label>
                    <span className="text-xs text-slate-500 font-mono">{settings.introDuration}s</span>
                </div>
                <input 
                   type="range" min="0" max="10" step="0.5"
                   value={settings.introDuration} 
                   onChange={(e) => setSettings({...settings, introDuration: Number(e.target.value)})}
                   className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-rose-500"
                />
                <p className="text-[10px] text-slate-500">Adds silence and title card at start of recording.</p>
             </div>

          </div>

          {/* Playback Controls */}
          <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800 shadow-xl">
             <div className="flex justify-center items-center gap-8">
                <button 
                  onClick={togglePlay}
                  className="w-16 h-16 flex items-center justify-center bg-sky-500 hover:bg-sky-400 text-white rounded-full shadow-lg shadow-sky-900/50 transition-all hover:scale-105 active:scale-95"
                >
                  {isPlaying ? <Pause fill="currentColor" size={28} /> : <Play fill="currentColor" className="ml-1" size={28} />}
                </button>
             </div>
             
             {/* Progress Bar */}
             <div className="mt-6 space-y-2">
                <input 
                    type="range"
                    min="0"
                    max={audioRef.current?.duration || 100}
                    value={currentTime}
                    onChange={(e) => {
                        const t = Number(e.target.value);
                        if(audioRef.current) audioRef.current.currentTime = t;
                        setCurrentTime(t);
                    }}
                    className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-slate-400 hover:accent-sky-400"
                />
                <div className="flex justify-between text-xs font-mono text-slate-500">
                    <span>{new Date(currentTime * 1000).toISOString().substr(14, 5)}</span>
                    <span>{audioRef.current?.duration ? new Date(audioRef.current.duration * 1000).toISOString().substr(14, 5) : "00:00"}</span>
                </div>
             </div>
          </div>
        </div>

        {/* Right Panel: Canvas Preview */}
        <div className="flex-1 order-1 xl:order-2 flex flex-col min-w-0">
            <div className="relative w-full aspect-video bg-black rounded-xl overflow-hidden shadow-2xl border border-slate-800 ring-1 ring-white/10 group">
               {/* The Main Stage */}
               <canvas
                  ref={canvasRef}
                  width={settings.videoWidth}
                  height={settings.videoHeight}
                  className="w-full h-full object-contain bg-[#0f172a]"
               />
               
               {/* Intro Overlay Indicator (Optional Visual Feedback) */}
               {recordingPhase === 'intro' && (
                  <div className="absolute top-4 right-4 px-3 py-1 bg-rose-600/90 text-white text-xs font-bold rounded-full animate-pulse">
                      REC • INTRO
                  </div>
               )}

               {/* Hidden Audio Element used for playback sync */}
               {media.audioUrl && (
                  <audio 
                    ref={audioRef} 
                    src={media.audioUrl} 
                    onEnded={() => { setIsPlaying(false); if(isRecording) stopRecording(); }}
                  />
               )}
            </div>
            
            <div className="mt-4 flex justify-between items-center text-slate-500 text-sm px-1">
               <p>Preview • 16:9 • {settings.videoWidth}x{settings.videoHeight}</p>
               {media.lyrics.length > 0 && <p className="text-sky-500/80">Synched</p>}
            </div>
        </div>

      </main>
    </div>
  );
}

// --- INIT ---

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);