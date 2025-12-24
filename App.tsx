import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, Music, Image as ImageIcon, FileText, Play, Pause, Download, MonitorPlay, Settings, AlignLeft, Sun, Sparkles } from 'lucide-react';
import { parseLrc } from './utils/lrcParser.ts';
import { renderFrame } from './utils/renderer.ts';
import type { MediaState, AppSettings } from './types.ts';

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

        if (recordingPhase === 'intro') {
            // In Intro Recording Mode
            isIntro = true;
            const elapsed = (Date.now() - introStartTimeRef.current) / 1000;
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
        // Only snap if we are extremely close (sub-pixel level) to avoid "jerky" stops.
        // Or if we seeked far away.
        if (absDiff > 10) {
            smoothIndexRef.current = activeIndex; // Seek snap
        } else if (absDiff < 0.001) {
            smoothIndexRef.current = activeIndex; // Micro snap to stop calculation
        } else {
            // Lerp factor of 0.1 is standard, but keeping the loop running 
            // until < 0.001 ensures smooth settling.
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
  const startRecording = () => {
    if (!canvasRef.current || !audioRef.current) return;
    
    // 1. Setup Stream
    const canvasStream = canvasRef.current.captureStream(60); 
    const finalStream = new MediaStream([...canvasStream.getTracks()]);
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const audioEl = audioRef.current as any;
    if (audioEl.captureStream || audioEl.mozCaptureStream) {
       const audioStream = audioEl.captureStream ? audioEl.captureStream() : audioEl.mozCaptureStream();
       audioStream.getAudioTracks().forEach((track: MediaStreamTrack) => finalStream.addTrack(track));
    }

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
        };

        mediaRecorderRef.current = recorder;
        chunksRef.current = [];
        recorder.start();
        setIsRecording(true);
        setDownloadUrl(null);

        // 2. Start Intro Phase
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

export default App;