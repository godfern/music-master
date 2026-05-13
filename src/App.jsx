import { useState, useRef, useEffect, useCallback } from "react";

// ── OSMD loader ────────────────────────────────────────────────────────────
function useOSMD() {
  const [ready, setReady] = useState(!!window.opensheetmusicdisplay);
  useEffect(() => {
    if (window.opensheetmusicdisplay) { setReady(true); return; }
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/opensheetmusicdisplay@1.8.9/build/opensheetmusicdisplay.min.js";
    s.onload = () => setReady(true);
    document.head.appendChild(s);
  }, []);
  return ready;
}

// ── OSMD Score Viewer ──────────────────────────────────────────────────────
function OsmdViewer({ xmlContent, currentMeasure }) {
  const ref = useRef(null);
  const osmdRef = useRef(null);
  const [status, setStatus] = useState("idle");
  const [err, setErr] = useState("");
  const ready = useOSMD();

  useEffect(() => {
    if (!ready || !ref.current || !xmlContent) return;
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        ref.current.innerHTML = "";
        const OSMD = window.opensheetmusicdisplay.OpenSheetMusicDisplay;
        const osmd = new OSMD(ref.current, {
          autoResize: true, backend: "svg",
          drawTitle: true, drawComposer: true, drawPartNames: true,
          drawMeasureNumbers: true, followCursor: true,
          cursorsOptions: [{ type: 0, color: "#f59e0b", alpha: 0.45, follow: true }],
        });
        await osmd.load(xmlContent);
        osmd.render();
        try { osmd.cursor.show(); } catch(e) {}
        if (!cancelled) { osmdRef.current = osmd; setStatus("ready"); }
      } catch(e) {
        if (!cancelled) { setErr(e.message); setStatus("error"); }
      }
    })();
    return () => { cancelled = true; };
  }, [xmlContent, ready]);

  useEffect(() => {
    if (!osmdRef.current) return;
    try {
      osmdRef.current.cursor.reset();
      if (currentMeasure > 0) {
        for (let i = 0; i < currentMeasure; i++) osmdRef.current.cursor.next();
      }
    } catch(e) {}
  }, [currentMeasure]);

  if (!xmlContent) return null;
  if (status === "loading") return (
    <div style={{padding:32,textAlign:"center",color:"#a8a29e",fontSize:13}}>
      <span style={{display:"inline-block",animation:"spin .8s linear infinite",marginRight:8}}>⟳</span>
      Rendering score with OSMD…
    </div>
  );
  if (status === "error") return (
    <div style={{padding:14,background:"#fef2f2",borderRadius:8,color:"#ef4444",fontSize:12}}>⚠ OSMD: {err}</div>
  );
  return <div ref={ref} style={{width:"100%",overflowX:"auto"}} />;
}

// ── Helpers ────────────────────────────────────────────────────────────────
const TRACK_COLORS      = ["#6366f1","#f59e0b","#10b981","#ef4444","#8b5cf6","#06b6d4","#f97316","#84cc16"];
const TRACK_COLORS_LIGHT= ["#e0e7ff","#fef3c7","#d1fae5","#fee2e2","#ede9fe","#cffafe","#ffedd5","#ecfccb"];

function uid() { return Math.random().toString(36).slice(2,9); }

function formatTime(sec) {
  if (!isFinite(sec)||sec<0) return "0:00";
  const m=Math.floor(sec/60), s=Math.floor(sec%60);
  return `${m}:${s.toString().padStart(2,"0")}`;
}

// Read a File as ArrayBuffer — works in sandboxed iframes unlike fetch(blobUrl)
function readFileAsArrayBuffer(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result);
    r.onerror = () => rej(new Error("FileReader failed"));
    r.readAsArrayBuffer(file);
  });
}

function readFileAsText(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result);
    r.onerror = () => rej(new Error("FileReader failed"));
    r.readAsText(file);
  });
}

function isAudioFile(file) {
  if (!file) return false;
  if (file.type.startsWith("audio/")) return true;
  return /\.(mp3|wav|ogg|flac|aac|m4a|opus|weba)$/i.test(file.name);
}

function isScoreFile(file) {
  if (!file) return false;
  return /\.(xml|mxl|musicxml)$/i.test(file.name) ||
         file.type === "application/xml" || file.type === "text/xml" ||
         file.type === "application/vnd.recordare.musicxml+xml";
}

// ── Waveform visualiser ────────────────────────────────────────────────────
function WaveBar({ analyser, color, active }) {
  const canvasRef = useRef(null);
  const rafRef    = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;

    if (!analyser || !active) {
      ctx.clearRect(0,0,W,H);
      ctx.strokeStyle = color + "35";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0,H/2); ctx.lineTo(W,H/2); ctx.stroke();
      return;
    }

    const buf = new Uint8Array(analyser.frequencyBinCount);
    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(buf);
      ctx.clearRect(0,0,W,H);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const step = W / buf.length;
      buf.forEach((v,i) => {
        const y = (v/128)*H/2;
        i===0 ? ctx.moveTo(0,y) : ctx.lineTo(i*step,y);
      });
      ctx.stroke();
    };
    draw();
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [analyser, active, color]);

  return (
    <canvas ref={canvasRef} width={300} height={32}
      style={{width:"100%",height:32,display:"block",borderRadius:4}}/>
  );
}

// ── Drop Area ──────────────────────────────────────────────────────────────
function DropArea({ onFiles, accept, multiple, color="#6366f1", children }) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);
  const handle = files => { if (files?.length) onFiles(Array.from(files)); };
  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={e=>{e.preventDefault();setDrag(true);}}
      onDragLeave={()=>setDrag(false)}
      onDrop={e=>{e.preventDefault();setDrag(false);handle(e.dataTransfer.files);}}
      style={{
        border:`2px dashed ${drag?color:"#d6d3d1"}`,borderRadius:10,
        padding:"16px",textAlign:"center",cursor:"pointer",
        background:drag?color+"0d":"#fafaf8",transition:"all .18s",
      }}
    >
      {children}
      <input ref={inputRef} type="file" accept={accept} multiple={!!multiple}
        style={{display:"none"}} onChange={e=>handle(e.target.files)}/>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  // songs: [{id, title, scoreFile:{name,xmlContent}|null, tracks:[{id,name,color,colorLight,file,previewUrl}]}]
  const [songs,         setSongs]         = useState([]);
  const [activeSongId,  setActiveSongId]  = useState(null);
  const [addingSong,    setAddingSong]     = useState(false);
  const [newTitle,      setNewTitle]       = useState("");

  // Playback
  const [isPlaying,     setIsPlaying]     = useState(false);
  const [currentTime,   setCurrentTime]   = useState(0);
  const [duration,      setDuration]      = useState(0);
  const [currentMeasure,setCurrentMeasure]= useState(-1);
  const [mutedTracks,   setMutedTracks]   = useState({});
  const [soloTrack,     setSoloTrack]     = useState(null);
  const [analysers,     setAnalysers]     = useState({});
  const [decoding,      setDecoding]      = useState(false);
  const [decodeError,   setDecodeError]   = useState("");

  // Refs — never trigger re-renders
  const audioCtxRef   = useRef(null);   // single persistent AudioContext
  const sourcesRef    = useRef({});     // trackId -> {source, gainNode, analyser}
  const startedAtRef  = useRef(0);      // ctx.currentTime when play began
  const durationRef   = useRef(0);
  const rafRef        = useRef(null);
  const decodedBufs   = useRef({});     // trackId -> AudioBuffer  (persists across plays)
  const mutedRef      = useRef({});     // mirror of mutedTracks for use inside rAF
  const soloRef       = useRef(null);

  const activeSong = songs.find(s=>s.id===activeSongId) ?? null;

  // Keep mute/solo refs in sync
  useEffect(() => { mutedRef.current = mutedTracks; }, [mutedTracks]);
  useEffect(() => { soloRef.current  = soloTrack;   }, [soloTrack]);

  // ── Song management ──────────────────────────────────────────────────────
  const updateSong = (id, fn) => setSongs(p => p.map(s => s.id===id ? fn(s) : s));

  const createSong = () => {
    if (!newTitle.trim()) return;
    const s = { id:uid(), title:newTitle.trim(), scoreFile:null, tracks:[] };
    setSongs(p=>[...p,s]);
    setActiveSongId(s.id);
    setNewTitle(""); setAddingSong(false);
  };

  const deleteSong = (id) => {
    stopAll();
    songs.find(s=>s.id===id)?.tracks.forEach(t => {
      if (t.previewUrl) URL.revokeObjectURL(t.previewUrl);
      delete decodedBufs.current[t.id];
    });
    setSongs(p=>p.filter(s=>s.id!==id));
    if (activeSongId===id) setActiveSongId(null);
  };

  const selectSong = (id) => {
    if (id===activeSongId) return;
    stopAll();
    setActiveSongId(id);
    setMutedTracks({}); setSoloTrack(null);
    setCurrentTime(0); setCurrentMeasure(-1); setDuration(0);
    setDecodeError("");
  };

  // ── File uploads ─────────────────────────────────────────────────────────
  const handleScoreUpload = async (files) => {
    const file = files.find(isScoreFile) || files[0];
    if (!file) return;
    try {
      const xmlContent = await readFileAsText(file);
      updateSong(activeSongId, s=>({...s, scoreFile:{name:file.name, xmlContent}}));
    } catch(e) { alert("Could not read score file: "+e.message); }
  };

  const handleTrackUpload = (files) => {
    if (!activeSongId) return;
    const audioFiles = files.filter(isAudioFile);
    if (!audioFiles.length) { alert("Please upload audio files (MP3, WAV, OGG, FLAC, AAC, M4A)"); return; }
    setSongs(prev => prev.map(s => {
      if (s.id !== activeSongId) return s;
      const newTracks = audioFiles.map((file, i) => {
        const idx = (s.tracks.length + i) % TRACK_COLORS.length;
        return {
          id: uid(),
          name: file.name.replace(/\.[^.]+$/,""),
          color: TRACK_COLORS[idx],
          colorLight: TRACK_COLORS_LIGHT[idx],
          file,                                        // keep the actual File object
          previewUrl: URL.createObjectURL(file),       // for <audio> preview only
        };
      });
      return { ...s, tracks: [...s.tracks, ...newTracks] };
    }));
  };

  const removeTrack = (trackId) => {
    stopAll();
    const track = activeSong?.tracks.find(t=>t.id===trackId);
    if (track?.previewUrl) URL.revokeObjectURL(track.previewUrl);
    delete decodedBufs.current[trackId];
    updateSong(activeSongId, s=>({...s, tracks:s.tracks.filter(t=>t.id!==trackId)}));
  };

  // ── AudioContext (one persistent, resumed on play) ───────────────────────
  const getCtx = () => {
    if (!audioCtxRef.current || audioCtxRef.current.state==="closed") {
      audioCtxRef.current = new (window.AudioContext||window.webkitAudioContext)();
    }
    return audioCtxRef.current;
  };

  // ── Decode all tracks (only once per track) ──────────────────────────────
  const ensureDecoded = async (tracks) => {
    const ctx = getCtx();
    for (const track of tracks) {
      if (decodedBufs.current[track.id]) continue;
      const ab = await readFileAsArrayBuffer(track.file);  // FileReader, no fetch
      // decodeAudioData may need a fresh ArrayBuffer copy
      const copy = ab.slice(0);
      decodedBufs.current[track.id] = await ctx.decodeAudioData(copy);
    }
  };

  // ── Stop all audio ───────────────────────────────────────────────────────
  const stopAll = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current=null; }
    Object.values(sourcesRef.current).forEach(({source}) => {
      try { source.stop(); source.disconnect(); } catch(e){}
    });
    sourcesRef.current = {};
    setIsPlaying(false); setCurrentTime(0); setCurrentMeasure(-1); setAnalysers({});
  }, []);

  // ── Start playback ───────────────────────────────────────────────────────
  const startPlayback = useCallback(async () => {
    if (!activeSong?.tracks.length) return;
    stopAll();
    setDecodeError(""); setDecoding(true);

    try {
      await ensureDecoded(activeSong.tracks);
    } catch(e) {
      setDecoding(false);
      setDecodeError("Could not decode audio: "+e.message);
      return;
    }
    setDecoding(false);

    const ctx = getCtx();
    if (ctx.state==="suspended") await ctx.resume();

    const maxDur = Math.max(...activeSong.tracks.map(t=>decodedBufs.current[t.id]?.duration||0));
    durationRef.current = maxDur;
    setDuration(maxDur);

    const newAnalysers = {};
    const newSources   = {};

    activeSong.tracks.forEach(track => {
      const buffer = decodedBufs.current[track.id];
      if (!buffer) return;

      const source   = ctx.createBufferSource();
      source.buffer  = buffer;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;

      const gainNode = ctx.createGain();
      const isMuted  = soloRef.current ? soloRef.current!==track.id : !!mutedRef.current[track.id];
      gainNode.gain.value = isMuted ? 0 : 1;

      source.connect(analyser);
      analyser.connect(gainNode);
      gainNode.connect(ctx.destination);

      source.start(0);

      newSources[track.id]   = { source, gainNode, analyser };
      newAnalysers[track.id] = analyser;
    });

    sourcesRef.current = newSources;
    startedAtRef.current = ctx.currentTime;
    setAnalysers(newAnalysers);
    setIsPlaying(true);

    const MEASURE_DUR = 2.4; // ~100bpm 4/4
    const tick = () => {
      const elapsed = getCtx().currentTime - startedAtRef.current;
      setCurrentTime(Math.min(elapsed, durationRef.current));
      setCurrentMeasure(Math.floor(elapsed / MEASURE_DUR));
      if (elapsed >= durationRef.current) { stopAll(); return; }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [activeSong, stopAll]);

  // ── Mute / Solo (live gain update) ───────────────────────────────────────
  const applyGains = useCallback((newMuted, newSolo) => {
    const ctx = audioCtxRef.current;
    if (!ctx || !activeSong) return;
    activeSong.tracks.forEach(t => {
      const node = sourcesRef.current[t.id];
      if (!node) return;
      const muted = newSolo ? newSolo!==t.id : !!newMuted[t.id];
      node.gainNode.gain.setTargetAtTime(muted?0:1, ctx.currentTime, 0.015);
    });
  }, [activeSong]);

  const toggleMute = (trackId) => {
    if (soloTrack) return;
    const next = { ...mutedTracks, [trackId]: !mutedTracks[trackId] };
    setMutedTracks(next);
    applyGains(next, null);
  };

  const toggleSolo = (trackId) => {
    const next = soloTrack===trackId ? null : trackId;
    setSoloTrack(next);
    applyGains(mutedTracks, next);
  };

  // ── Seek ─────────────────────────────────────────────────────────────────
  const seekTo = useCallback(async (ratio) => {
    if (!activeSong?.tracks.length || !durationRef.current) return;
    const wasPlaying = isPlaying;
    stopAll();
    if (!wasPlaying) return;

    const ctx = getCtx();
    if (ctx.state==="suspended") await ctx.resume();
    const offset = ratio * durationRef.current;
    const newAnalysers = {}, newSources = {};

    activeSong.tracks.forEach(track => {
      const buffer = decodedBufs.current[track.id];
      if (!buffer) return;
      const source   = ctx.createBufferSource();
      source.buffer  = buffer;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      const gainNode = ctx.createGain();
      const isMuted  = soloRef.current ? soloRef.current!==track.id : !!mutedRef.current[track.id];
      gainNode.gain.value = isMuted ? 0 : 1;
      source.connect(analyser); analyser.connect(gainNode); gainNode.connect(ctx.destination);
      source.start(0, Math.min(offset, buffer.duration-0.05));
      newSources[track.id]   = { source, gainNode, analyser };
      newAnalysers[track.id] = analyser;
    });

    sourcesRef.current   = newSources;
    startedAtRef.current = ctx.currentTime - offset;
    setAnalysers(newAnalysers);
    setIsPlaying(true);

    const MEASURE_DUR = 2.4;
    const tick = () => {
      const elapsed = getCtx().currentTime - startedAtRef.current;
      setCurrentTime(Math.min(elapsed, durationRef.current));
      setCurrentMeasure(Math.floor(elapsed / MEASURE_DUR));
      if (elapsed >= durationRef.current) { stopAll(); return; }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [activeSong, isPlaying, stopAll]);

  useEffect(() => () => stopAll(), []);

  // ── Responsive breakpoint ─────────────────────────────────────────────────
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640);
  const [showSidebar, setShowSidebar] = useState(false);
  useEffect(() => {
    const fn = () => {
      const mobile = window.innerWidth < 640;
      setIsMobile(mobile);
      if (!mobile) setShowSidebar(false);
    };
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);

  // ── Derived ────────────────────────────────────────────────────────────────
  const progressPct = duration>0 ? Math.min((currentTime/duration)*100,100) : 0;
  const activeCount = activeSong?.tracks.filter(t=> soloTrack ? soloTrack===t.id : !mutedTracks[t.id]).length ?? 0;

  // ── Shared styles ──────────────────────────────────────────────────────────
  const btn = (extra={}) => ({
    border:"1px solid #d6d3d1", borderRadius:8, background:"#fff",
    cursor:"pointer", fontFamily:"Georgia,serif", fontSize:13,
    padding:"10px 16px", color:"#44403c", ...extra,
  });

  // ── Song list (reused in sidebar + mobile drawer) ──────────────────────────
  const SongList = () => (
    <>
      <div style={{padding:"0 14px 8px",fontSize:10,fontWeight:700,color:"#a8a29e",letterSpacing:".12em",textTransform:"uppercase"}}>Songs</div>
      {songs.length===0 && <div style={{padding:"10px 14px",fontSize:13,color:"#a8a29e",fontStyle:"italic"}}>No songs yet</div>}
      {songs.map(s=>(
        <div key={s.id} style={{display:"flex",alignItems:"center",
          background:activeSongId===s.id?"#fef3c7":"transparent",
          borderLeft:activeSongId===s.id?"3px solid #f59e0b":"3px solid transparent"}}>
          <button onClick={()=>{selectSong(s.id);setShowSidebar(false);}} style={{
            flex:1,textAlign:"left",padding:"11px 14px",border:"none",background:"transparent",
            cursor:"pointer",fontFamily:"Georgia,serif",minWidth:0,
          }}>
            <div style={{fontSize:14,fontWeight:activeSongId===s.id?700:500,
              color:activeSongId===s.id?"#92400e":"#44403c",
              whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s.title}</div>
            <div style={{fontSize:11,color:"#a8a29e",marginTop:2}}>
              {s.tracks.length} track{s.tracks.length!==1?"s":""}{s.scoreFile?" · 🎼":""}
            </div>
          </button>
          <button onClick={()=>deleteSong(s.id)}
            style={{padding:"12px",border:"none",background:"transparent",cursor:"pointer",color:"#d6d3d1",fontSize:18}}>×</button>
        </div>
      ))}
      {addingSong ? (
        <div style={{padding:"10px 14px"}}>
          <input autoFocus value={newTitle} onChange={e=>setNewTitle(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter")createSong();if(e.key==="Escape")setAddingSong(false);}}
            placeholder="Song title…"
            style={{width:"100%",padding:"10px",border:"1px solid #d6d3d1",borderRadius:8,
              fontSize:14,fontFamily:"Georgia,serif",marginBottom:8,outline:"none"}}/>
          <div style={{display:"flex",gap:6}}>
            <button onClick={createSong} style={{flex:1,padding:"9px",border:"none",borderRadius:8,
              background:"#f59e0b",color:"#fff",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600}}>Add</button>
            <button onClick={()=>setAddingSong(false)} style={{flex:1,padding:"9px",border:"1px solid #d6d3d1",
              borderRadius:8,background:"#fff",color:"#78716c",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif"}}>Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={()=>setAddingSong(true)} style={{
          display:"block",width:"calc(100% - 28px)",margin:"8px 14px",padding:"10px",
          border:"1px dashed #d6d3d1",borderRadius:8,background:"transparent",
          cursor:"pointer",fontSize:13,color:"#78716c",fontFamily:"Georgia,serif",
        }}>+ New Song</button>
      )}
    </>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{fontFamily:"Georgia,serif",background:"#fafaf8",minHeight:"100vh",color:"#1c1917"}}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
        *{box-sizing:border-box}
        input,button,select{-webkit-tap-highlight-color:transparent}
      `}</style>

      {/* ── Header ── */}
      <div style={{background:"#1c1917",padding:"13px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:100}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {isMobile && (
            <button onClick={()=>setShowSidebar(v=>!v)} style={{
              background:"transparent",border:"none",color:"#fafaf8",fontSize:20,
              cursor:"pointer",padding:"0 8px 0 0",lineHeight:1,
            }}>☰</button>
          )}
          <span style={{fontSize:22,color:"#fafaf8"}}>𝄞</span>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:"#fafaf8",letterSpacing:".02em"}}>ScoreView</div>
            {!isMobile && <div style={{fontSize:9,color:"#a8a29e",letterSpacing:".12em",textTransform:"uppercase"}}>Score + Multi-Track Player</div>}
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {activeSong && isPlaying && (
            <div style={{display:"flex",gap:4}}>
              {activeSong.tracks.map(t=>{
                const dim=soloTrack?soloTrack!==t.id:!!mutedTracks[t.id];
                return <div key={t.id} style={{width:6,height:6,borderRadius:"50%",
                  background:dim?"#555":t.color,boxShadow:!dim?`0 0 4px ${t.color}`:"none"}}/>;
              })}
            </div>
          )}
          <span style={{fontSize:11,color:"#78716c"}}>{songs.length} song{songs.length!==1?"s":""}</span>
        </div>
      </div>

      {/* ── Mobile sidebar overlay ── */}
      {isMobile && showSidebar && (
        <>
          <div onClick={()=>setShowSidebar(false)}
            style={{position:"fixed",inset:0,background:"rgba(0,0,0,.4)",zIndex:200}}/>
          <div style={{position:"fixed",top:0,left:0,bottom:0,width:280,background:"#fff",
            zIndex:201,overflowY:"auto",paddingTop:14,boxShadow:"4px 0 20px rgba(0,0,0,.15)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0 14px 12px"}}>
              <span style={{fontSize:15,fontWeight:700,color:"#1c1917"}}>𝄞 ScoreView</span>
              <button onClick={()=>setShowSidebar(false)}
                style={{background:"transparent",border:"none",fontSize:22,cursor:"pointer",color:"#78716c"}}>×</button>
            </div>
            <SongList/>
          </div>
        </>
      )}

      <div style={{display:"flex",minHeight:"calc(100vh - 52px)"}}>

        {/* ── Desktop sidebar ── */}
        {!isMobile && (
          <div style={{width:220,background:"#fff",borderRight:"1px solid #e7e5e4",
            padding:"14px 0",flexShrink:0,overflowY:"auto"}}>
            <SongList/>
          </div>
        )}

        {/* ── Main content ── */}
        <div style={{flex:1,padding:isMobile?"14px":"20px",overflowY:"auto",minWidth:0}}>

          {!activeSong ? (
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",
              justifyContent:"center",minHeight:380,gap:14,color:"#a8a29e",padding:"20px"}}>
              <div style={{fontSize:52,opacity:.2}}>𝄞</div>
              <div style={{fontSize:16,fontWeight:600,color:"#78716c",textAlign:"center"}}>No song selected</div>
              <div style={{fontSize:13,textAlign:"center"}}>
                {isMobile ? "Tap ☰ to open the menu and create a song" : "Create a new song in the sidebar"}
              </div>
              <button onClick={()=>isMobile?setShowSidebar(true):setAddingSong(true)}
                style={{...btn(),marginTop:6,padding:"12px 24px",fontSize:14}}>
                + New Song
              </button>
            </div>
          ) : (<>

            {/* Song title + mobile add-track shortcut */}
            <div style={{marginBottom:16,display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:10}}>
              <div style={{minWidth:0}}>
                <h2 style={{margin:"0 0 3px",fontSize:isMobile?18:21,fontWeight:700,
                  whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{activeSong.title}</h2>
                <div style={{fontSize:12,color:"#a8a29e"}}>
                  {activeSong.tracks.length} track{activeSong.tracks.length!==1?"s":""}
                  {activeSong.scoreFile?` · 🎼`:""}
                </div>
              </div>
            </div>

            {/* ── Transport ── */}
            <div style={{background:"#fff",border:"1px solid #e7e5e4",borderRadius:12,
              padding:isMobile?"12px 14px":"14px 18px",marginBottom:16}}>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>

                {/* Big tap-friendly play button */}
                <button onClick={isPlaying?stopAll:startPlayback}
                  disabled={!activeSong.tracks.length||decoding}
                  style={{
                    width:isMobile?52:46,height:isMobile?52:46,borderRadius:"50%",border:"none",
                    flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
                    fontSize:isMobile?20:17,color:"#fff",
                    background:activeSong.tracks.length&&!decoding?"#1c1917":"#e7e5e4",
                    cursor:activeSong.tracks.length&&!decoding?"pointer":"default",
                  }}>
                  {decoding
                    ? <span style={{display:"inline-block",animation:"spin .8s linear infinite",fontSize:16}}>⟳</span>
                    : isPlaying?"⏹":"▶"}
                </button>

                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                    <span style={{fontSize:13,fontWeight:600,color:"#44403c",fontFamily:"monospace"}}>{formatTime(currentTime)}</span>
                    <span style={{fontSize:13,color:"#a8a29e",fontFamily:"monospace"}}>{formatTime(duration)}</span>
                  </div>
                  {/* Seekbar — tall enough to tap on mobile */}
                  <div
                    style={{height:isMobile?10:5,background:"#e7e5e4",borderRadius:5,
                      cursor:"pointer",position:"relative",userSelect:"none"}}
                    onClick={e=>{const r=e.currentTarget.getBoundingClientRect();seekTo((e.clientX-r.left)/r.width);}}>
                    <div style={{position:"absolute",top:0,left:0,height:"100%",background:"#f59e0b",
                      borderRadius:5,width:progressPct+"%",pointerEvents:"none",transition:"width .08s linear"}}/>
                  </div>
                </div>
              </div>
              <div style={{fontSize:11,color:decodeError?"#ef4444":"#a8a29e",fontStyle:"italic"}}>
                {decodeError?`⚠ ${decodeError}`
                  :decoding?"Decoding audio…"
                  :!activeSong.tracks.length?"Add audio tracks below to enable playback"
                  :isPlaying?`Playing ${activeCount} of ${activeSong.tracks.length} track${activeSong.tracks.length!==1?"s":""}`
                  :"Press ▶ to play all tracks in sync"}
              </div>
            </div>

            {/* ── Instrument Tracks ── */}
            <div style={{marginBottom:20}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                <h3 style={{margin:0,fontSize:14,fontWeight:700,color:"#44403c"}}>
                  Instrument Tracks
                  {activeSong.tracks.length>0&&<span style={{fontSize:11,fontWeight:400,color:"#a8a29e",marginLeft:8}}>{activeSong.tracks.length} loaded</span>}
                </h3>
              </div>

              {/* Upload drop zone */}
              <DropArea onFiles={handleTrackUpload}
                accept="audio/*,.mp3,.wav,.ogg,.flac,.aac,.m4a,.opus" multiple color="#6366f1">
                <div style={{padding:"8px 0"}}>
                  <div style={{fontSize:28,marginBottom:6,opacity:.5}}>🎵</div>
                  <div style={{fontSize:13,fontWeight:600,color:"#44403c",marginBottom:3}}>
                    {isMobile?"Tap to add instrument audio":"Drop instrument audio files here"}
                  </div>
                  <div style={{fontSize:12,color:"#78716c",marginBottom:6}}>
                    {isMobile?"Select multiple files — one per instrument":"Select or drop multiple files at once — one per instrument"}
                  </div>
                  <div style={{display:"flex",gap:5,justifyContent:"center",flexWrap:"wrap"}}>
                    {["🎹","🎻","🎺","🥁","🎸","🎷","🎤"].map(i=>(
                      <span key={i} style={{fontSize:18}}>{i}</span>
                    ))}
                  </div>
                  <div style={{fontSize:11,color:"#a8a29e",marginTop:6}}>MP3 · WAV · OGG · FLAC · AAC · M4A</div>
                </div>
              </DropArea>

              {activeSong.tracks.length>0&&(
                <div style={{fontSize:11,color:"#a8a29e",margin:"8px 0 10px",fontStyle:"italic"}}>
                  {activeSong.tracks.length} track{activeSong.tracks.length!==1?"s":""} — all play in sync · tap above to add more
                </div>
              )}

              {activeSong.tracks.map((track,ti)=>{
                const isMuted = soloTrack?soloTrack!==track.id:!!mutedTracks[track.id];
                const isSolo  = soloTrack===track.id;
                const ICONS   = ["🎹","🎻","🎺","🥁","🎸","🎷","🎤","🪗","🎵"];
                const icon    = track.icon||ICONS[ti%ICONS.length];
                return (
                  <div key={track.id} style={{
                    background:"#fff",border:`1px solid ${!isMuted?track.color+"45":"#e7e5e4"}`,
                    borderRadius:12,marginBottom:10,overflow:"hidden",
                    opacity:isMuted?.42:1,transition:"opacity .2s,border-color .2s",
                  }}>
                    {/* Track top row: icon + name + remove */}
                    <div style={{
                      padding:"10px 14px",display:"flex",alignItems:"center",gap:10,
                      background:!isMuted?track.colorLight:"#f5f5f4",
                      borderBottom:`1px solid ${!isMuted?track.color+"20":"#e7e5e4"}`,
                    }}>
                      <span style={{
                        width:10,height:10,borderRadius:"50%",flexShrink:0,
                        background:!isMuted?track.color:"#d6d3d1",
                        animation:!isMuted&&isPlaying?"pulse 1.2s ease-in-out infinite":"none",
                        boxShadow:!isMuted&&isPlaying?`0 0 5px ${track.color}`:"none",
                      }}/>
                      {/* Icon picker */}
                      <select value={icon}
                        onChange={e=>updateSong(activeSongId,s=>({...s,tracks:s.tracks.map(t=>t.id===track.id?{...t,icon:e.target.value}:t)}))}
                        style={{border:"none",background:"transparent",fontSize:18,
                          cursor:"pointer",padding:0,outline:"none",flexShrink:0}}>
                        {["🎹","🎻","🎺","🥁","🎸","🎷","🎤","🪗","🎵","🎼","🎶"].map(i=>(
                          <option key={i} value={i}>{i}</option>
                        ))}
                      </select>
                      {/* Name */}
                      <input value={track.name}
                        onChange={e=>updateSong(activeSongId,s=>({...s,tracks:s.tracks.map(t=>t.id===track.id?{...t,name:e.target.value}:t)}))}
                        style={{flex:1,border:"none",background:"transparent",fontSize:14,fontWeight:600,
                          color:"#1c1917",fontFamily:"Georgia,serif",outline:"none",minWidth:0}}/>
                      <span style={{fontSize:10,padding:"2px 7px",borderRadius:4,background:track.color,
                        color:"#fff",fontWeight:700,flexShrink:0}}>#{ti+1}</span>
                      <button onClick={()=>removeTrack(track.id)}
                        style={{fontSize:18,padding:"0 4px",border:"none",background:"transparent",
                          cursor:"pointer",color:"#d6d3d1",lineHeight:1,flexShrink:0}}>×</button>
                    </div>

                    {/* Waveform */}
                    <div style={{padding:"8px 14px 6px"}}>
                      <WaveBar analyser={analysers[track.id]} color={track.color} active={!isMuted&&isPlaying}/>
                    </div>

                    {/* Mute / Solo row — large tap targets on mobile */}
                    <div style={{padding:"6px 14px 12px",display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                      <button onClick={()=>toggleMute(track.id)} disabled={!!soloTrack}
                        style={{
                          flex:1,minWidth:isMobile?0:80,padding:"9px 12px",borderRadius:8,
                          fontWeight:600,fontSize:13,cursor:soloTrack?"default":"pointer",
                          border:`1px solid ${mutedTracks[track.id]?"#ef4444":"#d6d3d1"}`,
                          background:mutedTracks[track.id]?"#fef2f2":"#fff",
                          color:mutedTracks[track.id]?"#ef4444":"#78716c",
                          opacity:soloTrack?.35:1,
                        }}>
                        {mutedTracks[track.id]?"🔇 Muted":"🔊 Mute"}
                      </button>
                      <button onClick={()=>toggleSolo(track.id)}
                        style={{
                          flex:1,minWidth:isMobile?0:80,padding:"9px 12px",borderRadius:8,
                          fontWeight:600,fontSize:13,cursor:"pointer",
                          border:`1px solid ${isSolo?track.color:"#d6d3d1"}`,
                          background:isSolo?track.color:"#fff",
                          color:isSolo?"#fff":"#78716c",
                        }}>
                        {isSolo?"★ Solo":"☆ Solo"}
                      </button>
                      <div style={{fontSize:10,color:"#b0a9a0",fontStyle:"italic",
                        flex:isMobile?"1 1 100%":"1",textAlign:isMobile?"left":"right",
                        whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                        {track.file?.name}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── Score ── */}
            <div style={{marginBottom:20}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
                <h3 style={{margin:0,fontSize:14,fontWeight:700,color:"#44403c"}}>
                  Music Score
                  {activeSong.scoreFile&&<span style={{fontSize:11,fontWeight:400,color:"#a8a29e",marginLeft:6}}>({activeSong.scoreFile.name})</span>}
                </h3>
                {activeSong.scoreFile&&(
                  <button onClick={()=>updateSong(activeSongId,s=>({...s,scoreFile:null}))}
                    style={{fontSize:12,padding:"6px 12px",border:"1px solid #d6d3d1",borderRadius:7,
                      background:"#fff",color:"#78716c",cursor:"pointer"}}>× Remove</button>
                )}
              </div>
              {activeSong.scoreFile ? (
                <div style={{background:"#fff",border:"1px solid #e7e5e4",borderRadius:10,padding:12,overflowX:"auto"}}>
                  <OsmdViewer xmlContent={activeSong.scoreFile.xmlContent} currentMeasure={currentMeasure}/>
                </div>
              ) : (
                <DropArea onFiles={handleScoreUpload} accept=".xml,.mxl,.musicxml" color="#059669">
                  <div style={{padding:"10px 0"}}>
                    <div style={{fontSize:28,marginBottom:6,opacity:.45}}>🎼</div>
                    <div style={{fontSize:13,fontWeight:600,color:"#44403c",marginBottom:3}}>
                      {isMobile?"Tap to upload MusicXML score":"Drop MusicXML score here"}
                    </div>
                    <div style={{fontSize:11,color:"#a8a29e"}}>Accepts .xml · .mxl · .musicxml</div>
                    <div style={{fontSize:11,color:"#a8a29e",marginTop:3}}>Free scores at musescore.com or imslp.org</div>
                  </div>
                </DropArea>
              )}
            </div>

            {/* Tip */}
            <div style={{padding:"12px 14px",background:"#fef3c7",borderRadius:10,
              fontSize:12,color:"#92400e",lineHeight:1.7,marginBottom:20}}>
              <strong>Tip:</strong> Upload one audio file per instrument — they all play together in sync.
              Use <strong>Mute</strong> to silence an instrument or <strong>Solo</strong> to hear only that one.
              {isMobile&&" Tap ☰ to switch songs."}
            </div>

          </>)}
        </div>
      </div>
    </div>
  );
}
