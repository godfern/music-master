import { useState, useRef, useEffect, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

// ── Supabase client ────────────────────────────────────────────────────────
// Replace these with your actual values from supabase.com → Settings → API
const SUPABASE_URL  = import.meta.env.VITE_SUPABASE_URL  || "";
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON || "";
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

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
  const ref    = useRef(null);
  const osmdRef= useRef(null);
  const [status, setStatus] = useState("idle");
  const [err,   setErr]     = useState("");
  const ready  = useOSMD();

  useEffect(() => {
    if (!ready||!ref.current||!xmlContent) return;
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        ref.current.innerHTML = "";
        const OSMD = window.opensheetmusicdisplay.OpenSheetMusicDisplay;
        const osmd = new OSMD(ref.current, {
          autoResize:true, backend:"svg",
          drawTitle:true, drawComposer:true, drawPartNames:true,
          drawMeasureNumbers:true, followCursor:true,
          cursorsOptions:[{type:0,color:"#f59e0b",alpha:.45,follow:true}],
        });
        await osmd.load(xmlContent);
        osmd.render();
        try { osmd.cursor.show(); } catch(e) {}
        if (!cancelled) { osmdRef.current=osmd; setStatus("ready"); }
      } catch(e) {
        if (!cancelled) { setErr(e.message); setStatus("error"); }
      }
    })();
    return () => { cancelled=true; };
  }, [xmlContent,ready]);

  useEffect(() => {
    if (!osmdRef.current) return;
    try {
      osmdRef.current.cursor.reset();
      for (let i=0;i<currentMeasure;i++) osmdRef.current.cursor.next();
    } catch(e) {}
  }, [currentMeasure]);

  if (!xmlContent) return null;
  if (status==="loading") return (
    <div style={{padding:32,textAlign:"center",color:"#a8a29e",fontSize:13}}>
      <span style={{display:"inline-block",animation:"spin .8s linear infinite",marginRight:8}}>⟳</span>Rendering…
    </div>
  );
  if (status==="error") return (
    <div style={{padding:14,background:"#fef2f2",borderRadius:8,color:"#ef4444",fontSize:12}}>⚠ OSMD: {err}</div>
  );
  return <div ref={ref} style={{width:"100%",overflowX:"auto"}}/>;
}

// ── Helpers ────────────────────────────────────────────────────────────────
const TRACK_COLORS       = ["#6366f1","#f59e0b","#10b981","#ef4444","#8b5cf6","#06b6d4","#f97316","#84cc16"];
const TRACK_COLORS_LIGHT = ["#e0e7ff","#fef3c7","#d1fae5","#fee2e2","#ede9fe","#cffafe","#ffedd5","#ecfccb"];
const TRACK_ICONS        = ["🎹","🎻","🎺","🥁","🎸","🎷","🎤","🪗","🎵"];

function formatTime(sec) {
  if (!isFinite(sec)||sec<0) return "0:00";
  return `${Math.floor(sec/60)}:${String(Math.floor(sec%60)).padStart(2,"0")}`;
}
function readAsArrayBuffer(file) {
  return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsArrayBuffer(file); });
}
function readAsText(file) {
  return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=rej; r.readAsText(file); });
}
function isAudio(f){ return f?.type.startsWith("audio/")||/\.(mp3|wav|ogg|flac|aac|m4a|opus)$/i.test(f?.name); }
function isScore(f){ return /\.(xml|mxl|musicxml)$/i.test(f?.name)||["application/xml","text/xml"].includes(f?.type); }

// ── Waveform ───────────────────────────────────────────────────────────────
function WaveBar({ analyser, color, active }) {
  const canvasRef = useRef(null);
  const rafRef    = useRef(null);
  useEffect(() => {
    const canvas=canvasRef.current; if (!canvas) return;
    const ctx=canvas.getContext("2d"), W=canvas.width, H=canvas.height;
    if (!analyser||!active) {
      ctx.clearRect(0,0,W,H); ctx.strokeStyle=color+"35"; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.moveTo(0,H/2); ctx.lineTo(W,H/2); ctx.stroke(); return;
    }
    const buf=new Uint8Array(analyser.frequencyBinCount);
    const draw=()=>{
      rafRef.current=requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(buf);
      ctx.clearRect(0,0,W,H); ctx.strokeStyle=color; ctx.lineWidth=1.5; ctx.beginPath();
      buf.forEach((v,i)=>{ const y=(v/128)*H/2; i===0?ctx.moveTo(0,y):ctx.lineTo(i*(W/buf.length),y); });
      ctx.stroke();
    };
    draw();
    return ()=>{ if(rafRef.current) cancelAnimationFrame(rafRef.current); };
  },[analyser,active,color]);
  return <canvas ref={canvasRef} width={300} height={32} style={{width:"100%",height:32,display:"block",borderRadius:4}}/>;
}

// ── Drop Area ──────────────────────────────────────────────────────────────
function DropArea({ onFiles, accept, multiple, color="#6366f1", children }) {
  const [drag,setDrag]=useState(false);
  const ref=useRef(null);
  const handle=files=>{ if(files?.length) onFiles(Array.from(files)); };
  return (
    <div onClick={()=>ref.current?.click()}
      onDragOver={e=>{e.preventDefault();setDrag(true);}}
      onDragLeave={()=>setDrag(false)}
      onDrop={e=>{e.preventDefault();setDrag(false);handle(e.dataTransfer.files);}}
      style={{border:`2px dashed ${drag?color:"#d6d3d1"}`,borderRadius:10,padding:16,
        textAlign:"center",cursor:"pointer",background:drag?color+"0d":"#fafaf8",transition:"all .18s"}}>
      {children}
      <input ref={ref} type="file" accept={accept} multiple={!!multiple}
        style={{display:"none"}} onChange={e=>handle(e.target.files)}/>
    </div>
  );
}

// ── Save indicator ─────────────────────────────────────────────────────────
function SaveBadge({ status }) {
  const cfg = {
    saving:  { bg:"#e0e7ff", color:"#3730a3", text:"⟳ Saving…"  },
    saved:   { bg:"#d1fae5", color:"#065f46", text:"✓ Saved"     },
    error:   { bg:"#fee2e2", color:"#991b1b", text:"⚠ Save failed"},
    idle:    null,
  }[status];
  if (!cfg) return null;
  return (
    <span style={{fontSize:11,padding:"3px 10px",borderRadius:20,background:cfg.bg,
      color:cfg.color,fontWeight:600,transition:"all .3s"}}>
      {cfg.text}
    </span>
  );
}

// ── Supabase not configured warning ───────────────────────────────────────
function NotConfigured() {
  return (
    <div style={{margin:20,padding:16,background:"#fef3c7",borderRadius:10,fontSize:13,color:"#92400e",lineHeight:1.8}}>
      <strong>⚙ Supabase not configured</strong><br/>
      Create a <code>.env</code> file in your project root with:<br/>
      <code style={{display:"block",background:"#fff7ed",padding:"8px 12px",borderRadius:6,marginTop:8,fontSize:12}}>
        VITE_SUPABASE_URL=https://your-project.supabase.co<br/>
        VITE_SUPABASE_ANON=your-anon-key
      </code>
      Then run <code>npm run dev</code> — songs will persist to your Supabase database.
    </div>
  );
}

// ── Track Recorder with Metronome ─────────────────────────────────────────
function getSupportedMimeType() {
  const types = ["audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus","audio/ogg"];
  return types.find(t => MediaRecorder.isTypeSupported(t)) || "";
}

function TrackRecorder({ trackId, trackColor, trackName, onSaveRecording }) {
  const [open,        setOpen]        = useState(false);
  const [bpm,         setBpm]         = useState(120);
  const [beatsPerBar, setBeatsPerBar] = useState(4);
  const [countIn,     setCountIn]     = useState(2);
  const [phase,       setPhase]       = useState("idle"); // idle|countdown|recording|done
  const [beat,        setBeat]        = useState(0);
  const [bar,         setBar]         = useState(0);
  const [elapsed,     setElapsed]     = useState(0);
  const [blob,        setBlob]        = useState(null);
  const [blobUrl,     setBlobUrl]     = useState(null);
  const [micError,    setMicError]    = useState("");

  const metroCtxRef    = useRef(null);
  const schedulerRef   = useRef(null);
  const mediaRecRef    = useRef(null);
  const chunksRef      = useRef([]);
  const nextBeatRef    = useRef(0);
  const beatCountRef   = useRef(0);
  const rafRef         = useRef(null);
  const startTimeRef   = useRef(0);
  const isRecordingRef = useRef(false); // when true, clicks are silent (visual only)

  // Click is only emitted during count-in. Once recording starts,
  // isRecordingRef=true and we skip the audio entirely → beat stays visual only.
  const scheduleClick = (ctx, time, isAccent) => {
    if (isRecordingRef.current) return; // silent during recording
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = isAccent ? 1000 : 800;
    gain.gain.setValueAtTime(isAccent ? 0.5 : 0.3, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
    osc.start(time);
    osc.stop(time + 0.05);
  };

  const runScheduler = useCallback((bpmVal, bpb) => {
    const ctx = metroCtxRef.current;
    if (!ctx) return;
    const secPerBeat = 60 / bpmVal;
    while (nextBeatRef.current < ctx.currentTime + 0.1) {
      const bc = beatCountRef.current;
      scheduleClick(ctx, nextBeatRef.current, bc % bpb === 0);
      const tCopy = nextBeatRef.current, bcCopy = bc;
      setTimeout(() => {
        setBeat(bcCopy % bpb);
        setBar(Math.floor(bcCopy / bpb));
      }, Math.max(0, (tCopy - ctx.currentTime) * 1000));
      nextBeatRef.current  += secPerBeat;
      beatCountRef.current += 1;
    }
    schedulerRef.current = setTimeout(() => runScheduler(bpmVal, bpb), 25);
  }, []);

  const stopSession = () => {
    if (schedulerRef.current) { clearTimeout(schedulerRef.current); schedulerRef.current = null; }
    if (rafRef.current)       { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (mediaRecRef.current?.state === "recording") mediaRecRef.current.stop();
    try { metroCtxRef.current?.close(); } catch(e) {}
    metroCtxRef.current  = null;
    isRecordingRef.current = false;
  };

  const startSession = async () => {
    setMicError(""); setBlob(null); setBlobUrl(null);
    isRecordingRef.current = false;

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch(e) {
      setMicError("Microphone access denied. Please allow mic access and try again.");
      return;
    }

    // Single AudioContext for the metronome (speakers only during count-in)
    const metroCtx = new (window.AudioContext || window.webkitAudioContext)();
    metroCtxRef.current = metroCtx;
    beatCountRef.current   = 0;
    nextBeatRef.current    = metroCtx.currentTime + 0.1;
    setPhase("countdown"); setBeat(0); setBar(0); setElapsed(0);
    runScheduler(bpm, beatsPerBar);

    const countInSecs = countIn * beatsPerBar * (60 / bpm);
    setTimeout(() => {
      // Silence the metronome the moment recording starts
      isRecordingRef.current = true;
      setPhase("recording");
      startTimeRef.current = Date.now();

      // MediaRecorder captures raw mic stream — no Web Audio in the chain
      const mr = new MediaRecorder(stream, { mimeType: getSupportedMimeType() });
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const b = new Blob(chunksRef.current, { type: getSupportedMimeType() });
        setBlobUrl(URL.createObjectURL(b)); setBlob(b); setPhase("done");
        stream.getTracks().forEach(t => t.stop());
      };
      mr.start(100);
      mediaRecRef.current = mr;

      const tick = () => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }, countInSecs * 1000);
  };

  const discard = () => {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlob(null); setBlobUrl(null); setPhase("idle");
  };

  const save = () => {
    if (!blob) return;
    const ext = getSupportedMimeType().includes("ogg") ? "ogg" : "webm";
    onSaveRecording(blob, `${trackName}-recording.${ext}`);
    discard(); setOpen(false);
  };

  useEffect(() => () => { stopSession(); if (blobUrl) URL.revokeObjectURL(blobUrl); }, []);

  const dots = Array.from({ length: beatsPerBar }, (_, i) => i);

  if (!open) return (
    <button onClick={() => setOpen(true)} style={{
      display:"flex", alignItems:"center", gap:5, padding:"7px 12px",
      border:`1px solid ${trackColor}60`, borderRadius:8, background:"transparent",
      cursor:"pointer", fontSize:12, fontWeight:600, color:trackColor,
    }}>🎙 Record</button>
  );

  return (
    <div style={{ margin:"0 14px 14px", border:`1px solid ${trackColor}40`,
      borderRadius:10, overflow:"hidden", background:"#fafaf8" }}>
      <div style={{ padding:"10px 14px", background:trackColor+"15",
        borderBottom:`1px solid ${trackColor}25`, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <span style={{ fontSize:13, fontWeight:700 }}>🎙 Recorder — {trackName}</span>
        <button onClick={() => { stopSession(); setOpen(false); discard(); }}
          style={{ border:"none", background:"transparent", fontSize:18, cursor:"pointer", color:"#a8a29e" }}>×</button>
      </div>

      <div style={{ padding:14 }}>

        {/* Controls — idle only */}
        {phase === "idle" && (
          <div style={{ display:"flex", gap:10, marginBottom:14, flexWrap:"wrap" }}>
            <div style={{ flex:"1 1 150px" }}>
              <div style={{ fontSize:11, fontWeight:600, color:"#78716c", marginBottom:5, textTransform:"uppercase", letterSpacing:".08em" }}>Tempo (BPM)</div>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <button onClick={() => setBpm(b => Math.max(40,b-5))}
                  style={{ width:28,height:28,borderRadius:6,border:"1px solid #d6d3d1",background:"#fff",cursor:"pointer",fontSize:14,fontWeight:700,color:"#44403c" }}>−</button>
                <div style={{ flex:1, textAlign:"center" }}>
                  <input type="range" min={40} max={240} value={bpm} onChange={e=>setBpm(Number(e.target.value))}
                    style={{ width:"100%", accentColor:trackColor }}/>
                  <div style={{ fontSize:22,fontWeight:700,color:trackColor,fontFamily:"monospace" }}>{bpm}</div>
                </div>
                <button onClick={() => setBpm(b => Math.min(240,b+5))}
                  style={{ width:28,height:28,borderRadius:6,border:"1px solid #d6d3d1",background:"#fff",cursor:"pointer",fontSize:14,fontWeight:700,color:"#44403c" }}>+</button>
              </div>
            </div>
            <div style={{ flex:"0 0 100px" }}>
              <div style={{ fontSize:11, fontWeight:600, color:"#78716c", marginBottom:5, textTransform:"uppercase", letterSpacing:".08em" }}>Time Sig</div>
              <select value={beatsPerBar} onChange={e=>setBeatsPerBar(Number(e.target.value))}
                style={{ width:"100%",padding:"7px 8px",border:"1px solid #d6d3d1",borderRadius:8,fontSize:14,fontFamily:"Georgia,serif",background:"#fff",outline:"none",cursor:"pointer" }}>
                {[2,3,4,6].map(n=><option key={n} value={n}>{n}/4</option>)}
              </select>
            </div>
            <div style={{ flex:"0 0 100px" }}>
              <div style={{ fontSize:11, fontWeight:600, color:"#78716c", marginBottom:5, textTransform:"uppercase", letterSpacing:".08em" }}>Count-in</div>
              <select value={countIn} onChange={e=>setCountIn(Number(e.target.value))}
                style={{ width:"100%",padding:"7px 8px",border:"1px solid #d6d3d1",borderRadius:8,fontSize:14,fontFamily:"Georgia,serif",background:"#fff",outline:"none",cursor:"pointer" }}>
                {[0,1,2,4].map(n=><option key={n} value={n}>{n===0?"None":`${n} bar${n>1?"s":""}`}</option>)}
              </select>
            </div>
          </div>
        )}

        {/* Beat dots */}
        {(phase==="countdown"||phase==="recording") && (
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:11,color:"#a8a29e",marginBottom:8,fontStyle:"italic" }}>
              {phase==="countdown"
                ? `🔊 Count-in: bar ${bar+1} of ${countIn}`
                : `🔴 Recording — bar ${bar-countIn+1} · metronome is visual only`}
            </div>
            <div style={{ display:"flex", gap:8, justifyContent:"center" }}>
              {dots.map(i => {
                const active = i===beat%(beatsPerBar);
                const accent = i===0;
                return (
                  <div key={i} style={{
                    width:accent?38:30, height:accent?38:30, borderRadius:"50%",
                    background:active?(phase==="countdown"?"#f59e0b":trackColor):(accent?"#e7e5e4":"#f5f5f4"),
                    border:`2px solid ${active?(phase==="countdown"?"#f59e0b":trackColor):"#e7e5e4"}`,
                    transition:"background .06s",
                    boxShadow:active?`0 0 10px ${phase==="countdown"?"#f59e0b80":trackColor+"80"}`:"none",
                    display:"flex",alignItems:"center",justifyContent:"center",
                    fontSize:12,fontWeight:700,color:active?"#fff":"#a8a29e",
                  }}>{i+1}</div>
                );
              })}
            </div>
            {phase==="recording" && (
              <div style={{ textAlign:"center",marginTop:10,fontSize:24,fontWeight:700,
                color:trackColor,fontFamily:"monospace",display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}>
                <span style={{ width:10,height:10,borderRadius:"50%",background:"#ef4444",
                  display:"inline-block",animation:"pulse 1s ease-in-out infinite" }}/>
                {formatTime(elapsed)}
              </div>
            )}
          </div>
        )}

        {/* Done */}
        {phase==="done" && blobUrl && (
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:12,color:"#059669",fontWeight:600,marginBottom:8 }}>
              ✓ Recording complete — {formatTime(elapsed)}
            </div>
            <audio controls src={blobUrl} style={{ width:"100%",marginBottom:10 }}/>
            <div style={{ display:"flex",gap:8 }}>
              <button onClick={save} style={{ flex:1,padding:10,borderRadius:8,border:"none",
                background:trackColor,color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer" }}>
                ✓ Use this recording
              </button>
              <button onClick={discard} style={{ flex:1,padding:10,borderRadius:8,
                border:"1px solid #d6d3d1",background:"#fff",color:"#78716c",fontSize:13,cursor:"pointer" }}>
                ✗ Discard
              </button>
            </div>
          </div>
        )}

        {micError && (
          <div style={{ padding:"10px 12px",background:"#fef2f2",borderRadius:8,color:"#ef4444",fontSize:12,marginBottom:12 }}>
            ⚠ {micError}
          </div>
        )}

        {phase==="idle" && (
          <button onClick={startSession} style={{ width:"100%",padding:11,borderRadius:8,border:"none",
            background:trackColor,color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",
            display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}>
            <span>🎙</span>
            {countIn>0?`Start with ${countIn}-bar count-in at ${bpm} BPM`:`Start Recording at ${bpm} BPM`}
          </button>
        )}
        {(phase==="countdown"||phase==="recording") && (
          <button onClick={stopSession} style={{ width:"100%",padding:11,borderRadius:8,border:"none",
            background:"#ef4444",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",
            display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}>
            ⏹ Stop
          </button>
        )}
      </div>
    </div>
  );
}

// ── New Track Recorder (creates a brand-new track, no upload needed) ───────
function NewTrackRecorder({ songId, trackCount, onSaveRecording }) {
  const [open,        setOpen]        = useState(false);
  const [trackName,   setTrackName]   = useState("");
  const [bpm,         setBpm]         = useState(120);
  const [beatsPerBar, setBeatsPerBar] = useState(4);
  const [countIn,     setCountIn]     = useState(2);
  const [phase,       setPhase]       = useState("idle");
  const [beat,        setBeat]        = useState(0);
  const [bar,         setBar]         = useState(0);
  const [elapsed,     setElapsed]     = useState(0);
  const [blob,        setBlob]        = useState(null);
  const [blobUrl,     setBlobUrl]     = useState(null);
  const [micError,    setMicError]    = useState("");

  const metroCtxRef    = useRef(null);
  const schedulerRef   = useRef(null);
  const mediaRecRef    = useRef(null);
  const chunksRef      = useRef([]);
  const nextBeatRef    = useRef(0);
  const beatCountRef   = useRef(0);
  const rafRef         = useRef(null);
  const startTimeRef   = useRef(0);
  const isRecordingRef = useRef(false);

  useEffect(() => {
    if (open) setTrackName(`Track ${trackCount + 1}`);
  }, [open]);

  const scheduleClick = (ctx, time, isAccent) => {
    if (isRecordingRef.current) return; // silent during recording — visual only
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = isAccent ? 1000 : 800;
    gain.gain.setValueAtTime(isAccent ? 0.5 : 0.3, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
    osc.start(time); osc.stop(time + 0.05);
  };

  const runScheduler = useCallback((bpmVal, bpb) => {
    const ctx = metroCtxRef.current; if (!ctx) return;
    const spb = 60 / bpmVal;
    while (nextBeatRef.current < ctx.currentTime + 0.1) {
      const bc = beatCountRef.current;
      scheduleClick(ctx, nextBeatRef.current, bc % bpb === 0);
      const tC = nextBeatRef.current, bC = bc;
      setTimeout(() => { setBeat(bC % bpb); setBar(Math.floor(bC / bpb)); },
        Math.max(0, (tC - ctx.currentTime) * 1000));
      nextBeatRef.current  += spb;
      beatCountRef.current += 1;
    }
    schedulerRef.current = setTimeout(() => runScheduler(bpmVal, bpb), 25);
  }, []);

  const stopSession = () => {
    if (schedulerRef.current) { clearTimeout(schedulerRef.current); schedulerRef.current = null; }
    if (rafRef.current)       { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (mediaRecRef.current?.state === "recording") mediaRecRef.current.stop();
    try { metroCtxRef.current?.close(); } catch(e) {}
    metroCtxRef.current    = null;
    isRecordingRef.current = false;
  };

  const startSession = async () => {
    setMicError(""); setBlob(null); setBlobUrl(null);
    isRecordingRef.current = false;
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch(e) { setMicError("Microphone access denied. Please allow mic access and try again."); return; }

    const metroCtx = new (window.AudioContext || window.webkitAudioContext)();
    metroCtxRef.current  = metroCtx;
    beatCountRef.current = 0;
    nextBeatRef.current  = metroCtx.currentTime + 0.1;
    setPhase("countdown"); setBeat(0); setBar(0); setElapsed(0);
    runScheduler(bpm, beatsPerBar);

    const countInSecs = countIn * beatsPerBar * (60 / bpm);
    setTimeout(() => {
      // Silence the metronome the instant recording starts
      isRecordingRef.current = true;
      setPhase("recording");
      startTimeRef.current = Date.now();
      const mr = new MediaRecorder(stream, { mimeType: getSupportedMimeType() });
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        const b = new Blob(chunksRef.current, { type: getSupportedMimeType() });
        setBlobUrl(URL.createObjectURL(b)); setBlob(b); setPhase("done");
        stream.getTracks().forEach(t => t.stop());
      };
      mr.start(100); mediaRecRef.current = mr;
      const tick = () => { setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000)); rafRef.current = requestAnimationFrame(tick); };
      rafRef.current = requestAnimationFrame(tick);
    }, countInSecs * 1000);
  };

  const discard = () => {
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    setBlob(null); setBlobUrl(null); setPhase("idle");
  };

  const save = () => {
    if (!blob) return;
    const ext  = getSupportedMimeType().includes("ogg") ? "ogg" : "webm";
    const name = `${trackName.trim() || "Recording"}.${ext}`;
    onSaveRecording(blob, name);
    discard(); setOpen(false);
  };

  useEffect(() => () => { stopSession(); if (blobUrl) URL.revokeObjectURL(blobUrl); }, []);

  const COLOR = "#ef4444";
  const dots  = Array.from({ length: beatsPerBar }, (_, i) => i);

  if (!open) return (
    <div onClick={() => setOpen(true)}
      style={{ flex:1, border:"2px dashed #fca5a5", borderRadius:10, padding:16,
        textAlign:"center", cursor:"pointer", background:"#fafaf8",
        display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
        gap:4, transition:"all .18s" }}
      onMouseEnter={e=>e.currentTarget.style.background="#fef2f2"}
      onMouseLeave={e=>e.currentTarget.style.background="#fafaf8"}>
      <div style={{fontSize:22, opacity:.6}}>🎙</div>
      <div style={{fontSize:13, fontWeight:600, color:"#ef4444"}}>Record new track</div>
      <div style={{fontSize:11, color:"#a8a29e"}}>Use your microphone</div>
    </div>
  );

  return (
    <div style={{ flex:1, border:"1px solid #fca5a580", borderRadius:10,
      overflow:"hidden", background:"#fafaf8" }}>
      {/* Header */}
      <div style={{ padding:"10px 14px", background:"#fef2f2",
        borderBottom:"1px solid #fca5a540", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <span style={{ fontSize:13, fontWeight:700, color:"#991b1b" }}>🎙 Record New Track</span>
        <button onClick={() => { stopSession(); discard(); setOpen(false); }}
          style={{ border:"none", background:"transparent", fontSize:18, cursor:"pointer", color:"#a8a29e" }}>×</button>
      </div>

      <div style={{ padding:14 }}>
        {/* Track name */}
        {phase === "idle" && (
          <div style={{ marginBottom:12 }}>
            <div style={{ fontSize:11, fontWeight:600, color:"#78716c", marginBottom:5,
              textTransform:"uppercase", letterSpacing:".08em" }}>Track Name</div>
            <input
              value={trackName}
              onChange={e => setTrackName(e.target.value)}
              placeholder="e.g. Violin I, Piano, Vocals…"
              style={{ width:"100%", padding:"8px 10px", border:"1px solid #d6d3d1", borderRadius:8,
                fontSize:13, fontFamily:"Georgia,serif", outline:"none" }}
            />
          </div>
        )}

        {/* BPM + time sig + count-in */}
        {phase === "idle" && (
          <div style={{ display:"flex", gap:10, marginBottom:14, flexWrap:"wrap" }}>
            <div style={{ flex:"1 1 130px" }}>
              <div style={{ fontSize:11, fontWeight:600, color:"#78716c", marginBottom:5,
                textTransform:"uppercase", letterSpacing:".08em" }}>Tempo (BPM)</div>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <button onClick={() => setBpm(b => Math.max(40, b-5))}
                  style={{ width:28,height:28,borderRadius:6,border:"1px solid #d6d3d1",background:"#fff",cursor:"pointer",fontSize:14,fontWeight:700,color:"#44403c" }}>−</button>
                <div style={{ flex:1, textAlign:"center" }}>
                  <input type="range" min={40} max={240} value={bpm}
                    onChange={e => setBpm(Number(e.target.value))}
                    style={{ width:"100%", accentColor:COLOR }}/>
                  <div style={{ fontSize:20, fontWeight:700, color:COLOR, fontFamily:"monospace" }}>{bpm}</div>
                </div>
                <button onClick={() => setBpm(b => Math.min(240, b+5))}
                  style={{ width:28,height:28,borderRadius:6,border:"1px solid #d6d3d1",background:"#fff",cursor:"pointer",fontSize:14,fontWeight:700,color:"#44403c" }}>+</button>
              </div>
            </div>
            <div style={{ flex:"0 0 90px" }}>
              <div style={{ fontSize:11, fontWeight:600, color:"#78716c", marginBottom:5,
                textTransform:"uppercase", letterSpacing:".08em" }}>Time Sig</div>
              <select value={beatsPerBar} onChange={e => setBeatsPerBar(Number(e.target.value))}
                style={{ width:"100%",padding:"7px 8px",border:"1px solid #d6d3d1",borderRadius:8,
                  fontSize:14,fontFamily:"Georgia,serif",background:"#fff",outline:"none",cursor:"pointer" }}>
                {[2,3,4,6].map(n => <option key={n} value={n}>{n}/4</option>)}
              </select>
            </div>
            <div style={{ flex:"0 0 90px" }}>
              <div style={{ fontSize:11, fontWeight:600, color:"#78716c", marginBottom:5,
                textTransform:"uppercase", letterSpacing:".08em" }}>Count-in</div>
              <select value={countIn} onChange={e => setCountIn(Number(e.target.value))}
                style={{ width:"100%",padding:"7px 8px",border:"1px solid #d6d3d1",borderRadius:8,
                  fontSize:14,fontFamily:"Georgia,serif",background:"#fff",outline:"none",cursor:"pointer" }}>
                {[0,1,2,4].map(n => <option key={n} value={n}>{n===0?"None":`${n} bar${n>1?"s":""}`}</option>)}
              </select>
            </div>
          </div>
        )}

        {/* Beat visualiser */}
        {(phase==="countdown"||phase==="recording") && (
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:11,color:"#a8a29e",marginBottom:8,fontStyle:"italic" }}>
              {phase==="countdown"
                ? `🔊 Count-in: bar ${bar+1} of ${countIn}`
                : `🔴 Recording "${trackName}" — bar ${bar-countIn+1} · metronome is visual only`}
            </div>
            <div style={{ display:"flex", gap:8, justifyContent:"center" }}>
              {dots.map(i => {
                const active = i === beat % beatsPerBar;
                const accent = i === 0;
                return (
                  <div key={i} style={{
                    width:accent?38:30, height:accent?38:30, borderRadius:"50%",
                    background: active ? (phase==="countdown"?"#f59e0b":COLOR) : (accent?"#e7e5e4":"#f5f5f4"),
                    border:`2px solid ${active?(phase==="countdown"?"#f59e0b":COLOR):"#e7e5e4"}`,
                    transition:"background .06s",
                    boxShadow:active?`0 0 10px ${phase==="countdown"?"#f59e0b":COLOR}80`:"none",
                    display:"flex",alignItems:"center",justifyContent:"center",
                    fontSize:12,fontWeight:700,color:active?"#fff":"#a8a29e",
                  }}>{i+1}</div>
                );
              })}
            </div>
            {phase==="recording" && (
              <div style={{ textAlign:"center",marginTop:10,fontSize:24,fontWeight:700,
                color:COLOR,fontFamily:"monospace",display:"flex",alignItems:"center",
                justifyContent:"center",gap:8 }}>
                <span style={{ width:10,height:10,borderRadius:"50%",background:"#ef4444",
                  display:"inline-block",animation:"pulse 1s ease-in-out infinite" }}/>
                {formatTime(elapsed)}
              </div>
            )}
          </div>
        )}

        {/* Done */}
        {phase==="done" && blobUrl && (
          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:12,color:"#059669",fontWeight:600,marginBottom:8 }}>
              ✓ Recording complete — {formatTime(elapsed)}
            </div>
            <audio controls src={blobUrl} style={{ width:"100%",marginBottom:10 }}/>
            <div style={{ display:"flex",gap:8 }}>
              <button onClick={save} style={{ flex:1,padding:10,borderRadius:8,border:"none",
                background:COLOR,color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer" }}>
                ✓ Add as "{trackName}"
              </button>
              <button onClick={discard} style={{ flex:1,padding:10,borderRadius:8,
                border:"1px solid #d6d3d1",background:"#fff",color:"#78716c",fontSize:13,cursor:"pointer" }}>
                ✗ Discard
              </button>
            </div>
          </div>
        )}

        {micError && (
          <div style={{ padding:"10px 12px",background:"#fef2f2",borderRadius:8,
            color:"#ef4444",fontSize:12,marginBottom:12 }}>⚠ {micError}</div>
        )}

        {phase==="idle" && (
          <button onClick={startSession} style={{ width:"100%",padding:11,borderRadius:8,
            border:"none",background:COLOR,color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",
            display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}>
            <span>🎙</span>
            {countIn>0 ? `Start with ${countIn}-bar count-in at ${bpm} BPM` : `Start Recording at ${bpm} BPM`}
          </button>
        )}
        {(phase==="countdown"||phase==="recording") && (
          <button onClick={stopSession} style={{ width:"100%",padding:11,borderRadius:8,
            border:"none",background:"#1c1917",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",
            display:"flex",alignItems:"center",justifyContent:"center",gap:8 }}>
            ⏹ Stop
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  const [songs,         setSongs]          = useState([]);
  const [activeSongId,  setActiveSongId]   = useState(null);
  const [addingSong,    setAddingSong]      = useState(false);
  const [newTitle,      setNewTitle]        = useState("");
  const [appLoading,    setAppLoading]      = useState(true);
  const [saveStatus,    setSaveStatus]      = useState("idle"); // idle|saving|saved|error
  const [sbReady,       setSbReady]         = useState(!!(SUPABASE_URL && SUPABASE_ANON));

  // Playback
  const [isPlaying,     setIsPlaying]      = useState(false);
  const [currentTime,   setCurrentTime]    = useState(0);
  const [duration,      setDuration]       = useState(0);
  const [currentMeasure,setCurrentMeasure] = useState(-1);
  const [mutedTracks,   setMutedTracks]    = useState({});
  const [soloTrack,     setSoloTrack]      = useState(null);
  const [trackVolumes,  setTrackVolumes]   = useState({}); // trackId -> 0..100
  const [analysers,     setAnalysers]      = useState({});
  const [decoding,      setDecoding]       = useState(false);
  const [decodeError,   setDecodeError]    = useState("");
  const [isMobile,      setIsMobile]       = useState(()=>window.innerWidth<640);
  const [showSidebar,   setShowSidebar]    = useState(false);

  const audioCtxRef  = useRef(null);
  const sourcesRef   = useRef({});
  const startedAtRef = useRef(0);
  const durationRef  = useRef(0);
  const rafRef       = useRef(null);
  const decodedBufs  = useRef({});
  const mutedRef     = useRef({});
  const soloRef      = useRef(null);
  const volumeRef    = useRef({});  // trackId -> 0..1
  const saveTimer    = useRef(null);

  const activeSong = songs.find(s=>s.id===activeSongId)??null;

  useEffect(()=>{ mutedRef.current=mutedTracks; },[mutedTracks]);
  useEffect(()=>{ soloRef.current=soloTrack; },[soloTrack]);
  useEffect(()=>{ volumeRef.current=trackVolumes; },[trackVolumes]);
  useEffect(()=>{
    const fn=()=>{ const m=window.innerWidth<640; setIsMobile(m); if(!m) setShowSidebar(false); };
    window.addEventListener("resize",fn);
    return ()=>window.removeEventListener("resize",fn);
  },[]);

  // ── Load all songs from Supabase on mount ─────────────────────────────────
  useEffect(()=>{
    if (!sbReady) { setAppLoading(false); return; }
    (async()=>{
      try {
        const { data: songRows, error: se } = await sb.from("songs").select("*").order("created_at");
        if (se) throw se;

        const { data: trackRows, error: te } = await sb.from("tracks").select("*").order("position");
        if (te) throw te;

        const { data: scoreRows, error: re } = await sb.from("scores").select("*");
        if (re) throw re;

        const loaded = (songRows||[]).map(s=>({
          id:       s.id,
          title:    s.title,
          tracks:   (trackRows||[])
            .filter(t=>t.song_id===s.id)
            .map(t=>({
              id:         t.id,
              name:       t.name,
              icon:       t.icon||"🎵",
              color:      t.color,
              colorLight: t.color_light,
              audioUrl:   t.audio_url,
              file:       null,
            })),
          scoreFile: (scoreRows||[]).find(r=>r.song_id===s.id)
            ? { name: (scoreRows||[]).find(r=>r.song_id===s.id).name,
                xmlContent: (scoreRows||[]).find(r=>r.song_id===s.id).xml_content,
                dbId: (scoreRows||[]).find(r=>r.song_id===s.id).id }
            : null,
        }));
        setSongs(loaded);
        if (loaded.length) {
          setActiveSongId(loaded[0].id);

        }
      } catch(e) {
        console.error("Load error:", e);
      } finally {
        setAppLoading(false);
      }
    })();
  },[sbReady]);

  // ── Debounced save indicator ───────────────────────────────────────────────
  const flashSaved = ()=>{
    setSaveStatus("saved");
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(()=>setSaveStatus("idle"), 2500);
  };

  // ── Song CRUD ──────────────────────────────────────────────────────────────
  const updateSong = (id,fn) => setSongs(p=>p.map(s=>s.id===id?fn(s):s));

  const createSong = async ()=>{
    if (!newTitle.trim()) return;
    const title = newTitle.trim();
    setNewTitle(""); setAddingSong(false);

    if (!sbReady) {
      // local-only fallback
      const s={id:crypto.randomUUID(),title,tracks:[],scoreFile:null};
      setSongs(p=>[...p,s]); setActiveSongId(s.id); return;
    }
    setSaveStatus("saving");
    try {
      const { data, error } = await sb.from("songs").insert({title}).select().single();
      if (error) throw error;
      const s={id:data.id,title:data.title,tracks:[],scoreFile:null};
      setSongs(p=>[...p,s]); setActiveSongId(s.id);
      flashSaved();
    } catch(e) {
      console.error(e); setSaveStatus("error");
    }
  };

  const deleteSong = async (id)=>{
    stopAll();
    setSongs(p=>p.filter(s=>s.id!==id));
    if (activeSongId===id) setActiveSongId(songs.find(s=>s.id!==id)?.id??null);
    if (!sbReady) return;
    // Cascade deletes tracks + scores via DB foreign key
    await sb.from("songs").delete().eq("id",id);
  };

  const selectSong = (id)=>{
    if (id===activeSongId) return;
    stopAll(); setActiveSongId(id); setMutedTracks({}); setSoloTrack(null);
    setTrackVolumes({});
    setCurrentTime(0); setCurrentMeasure(-1); setDuration(0); setDecodeError("");
  };

  // ── Track upload ───────────────────────────────────────────────────────────
  const handleTrackUpload = async (files)=>{
    if (!activeSongId) return;
    const audioFiles = files.filter(isAudio);
    if (!audioFiles.length) { alert("Please upload audio files (MP3, WAV, OGG, FLAC, AAC, M4A)"); return; }

    const song = songs.find(s=>s.id===activeSongId);
    setSaveStatus("saving");

    for (let i=0; i<audioFiles.length; i++) {
      const file = audioFiles[i];
      const idx  = (song.tracks.length+i)%TRACK_COLORS.length;
      const trackId = crypto.randomUUID();
      const color      = TRACK_COLORS[idx];
      const colorLight = TRACK_COLORS_LIGHT[idx];
      const icon       = TRACK_ICONS[idx];
      const name       = file.name.replace(/\.[^.]+$/,"");
      const position   = song.tracks.length+i;

      // Optimistic UI — add with local blob URL first
      const previewUrl = URL.createObjectURL(file);
      const optimistic = {id:trackId,name,icon,color,colorLight,audioUrl:previewUrl,file,volume:100};
      updateSong(activeSongId,s=>({...s,tracks:[...s.tracks,optimistic]}));
      setTrackVolumes(p=>({...p,[trackId]:100}));

      if (!sbReady) continue;

      try {
        // Upload audio file to Supabase Storage
        const ext  = file.name.split(".").pop();
        const path = `${activeSongId}/${trackId}.${ext}`;
        const { error: upErr } = await sb.storage.from("audio").upload(path, file, {upsert:true});
        if (upErr) throw upErr;

        const { data: urlData } = sb.storage.from("audio").getPublicUrl(path);
        const audioUrl = urlData.publicUrl;

        // Save track row
        const { error: dbErr } = await sb.from("tracks").insert({
          id:trackId, song_id:activeSongId, name, icon, color,
          color_light:colorLight, position, audio_path:path, audio_url:audioUrl,
        });
        if (dbErr) throw dbErr;

        // Update local with permanent URL (revoke temp blob)
        URL.revokeObjectURL(previewUrl);
        updateSong(activeSongId,s=>({...s,tracks:s.tracks.map(t=>
          t.id===trackId?{...t,audioUrl,file}:t
        )}));
      } catch(e) {
        console.error("Track upload error:",e); setSaveStatus("error"); return;
      }
    }
    flashSaved();
  };

  const removeTrack = async (trackId)=>{
    stopAll();
    const track = activeSong?.tracks.find(t=>t.id===trackId);
    if (track?.audioUrl?.startsWith("blob:")) URL.revokeObjectURL(track.audioUrl);
    delete decodedBufs.current[trackId];
    updateSong(activeSongId,s=>({...s,tracks:s.tracks.filter(t=>t.id!==trackId)}));
    if (!sbReady) return;
    await sb.from("tracks").delete().eq("id",trackId);
  };

  const renameTrack = async (trackId, name)=>{
    updateSong(activeSongId,s=>({...s,tracks:s.tracks.map(t=>t.id===trackId?{...t,name}:t)}));
    if (!sbReady) return;
    await sb.from("tracks").update({name}).eq("id",trackId);
  };

  const changeTrackIcon = async (trackId, icon)=>{
    updateSong(activeSongId,s=>({...s,tracks:s.tracks.map(t=>t.id===trackId?{...t,icon}:t)}));
    if (!sbReady) return;
    await sb.from("tracks").update({icon}).eq("id",trackId);
  };

  const changeTrackVolume = (trackId, volume)=>{
    setTrackVolumes(p=>({...p,[trackId]:volume}));
    const ctx=audioCtxRef.current;
    const node=sourcesRef.current[trackId];
    if (ctx&&node) {
      const muted=soloRef.current?soloRef.current!==trackId:!!mutedRef.current[trackId];
      node.gainNode.gain.setTargetAtTime(muted?0:volume/100, ctx.currentTime, .015);
    }
  };

  // Called by TrackRecorder when user hits "Use this recording"
  // Treats the recorded blob exactly like a file upload
  const handleSaveRecording = (blob, name) => {
    const file = new File([blob], name, { type: blob.type });
    handleTrackUpload([file]);
  };

  // ── Score upload ───────────────────────────────────────────────────────────
  const handleScoreUpload = async (files)=>{
    const file = files.find(isScore)||files[0];
    if (!file) return;
    setSaveStatus("saving");
    try {
      const xmlContent = await readAsText(file);
      const scoreFile  = {name:file.name,xmlContent};

      if (!sbReady) {
        updateSong(activeSongId,s=>({...s,scoreFile})); flashSaved(); return;
      }

      // Upsert — remove old score row if exists, insert new
      const existing = activeSong?.scoreFile?.dbId;
      if (existing) await sb.from("scores").delete().eq("id",existing);

      const { data, error } = await sb.from("scores").insert({
        song_id:activeSongId, name:file.name, xml_content:xmlContent,
      }).select().single();
      if (error) throw error;

      updateSong(activeSongId,s=>({...s,scoreFile:{...scoreFile,dbId:data.id}}));
      flashSaved();
    } catch(e) {
      console.error(e); setSaveStatus("error");
    }
  };

  const removeScore = async ()=>{
    const dbId = activeSong?.scoreFile?.dbId;
    updateSong(activeSongId,s=>({...s,scoreFile:null}));
    if (!sbReady||!dbId) return;
    await sb.from("scores").delete().eq("id",dbId);
  };

  // ── Audio context ──────────────────────────────────────────────────────────
  const getCtx=()=>{
    if (!audioCtxRef.current||audioCtxRef.current.state==="closed")
      audioCtxRef.current=new (window.AudioContext||window.webkitAudioContext)();
    if (audioCtxRef.current.state==="suspended") audioCtxRef.current.resume();
    return audioCtxRef.current;
  };

  const ensureDecoded = async (tracks)=>{
    const ctx=getCtx();
    for (const t of tracks) {
      if (decodedBufs.current[t.id]) continue;
      let ab;
      if (t.file) {
        ab = await readAsArrayBuffer(t.file);
      } else if (t.audioUrl) {
        const resp = await fetch(t.audioUrl);
        ab = await resp.arrayBuffer();
      } else continue;
      decodedBufs.current[t.id] = await ctx.decodeAudioData(ab.slice(0));
    }
  };

  const stopAll=useCallback(()=>{
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current=null; }
    Object.values(sourcesRef.current).forEach(({source})=>{ try{source.stop();source.disconnect();}catch(e){} });
    sourcesRef.current={};
    setIsPlaying(false); setCurrentTime(0); setCurrentMeasure(-1); setAnalysers({});
  },[]);

  const applyGains=useCallback((muted,solo)=>{
    const ctx=audioCtxRef.current; if (!ctx||!activeSong) return;
    activeSong.tracks.forEach(t=>{
      const node=sourcesRef.current[t.id]; if (!node) return;
      const m=solo?solo!==t.id:!!muted[t.id];
      const vol=(volumeRef.current[t.id]??100)/100;
      node.gainNode.gain.setTargetAtTime(m?0:vol,ctx.currentTime,.015);
    });
  },[activeSong]);

  const startPlayback=useCallback(async()=>{
    if (!activeSong?.tracks.length) return;
    stopAll(); setDecodeError(""); setDecoding(true);
    try { await ensureDecoded(activeSong.tracks); }
    catch(e){ setDecoding(false); setDecodeError("Could not decode: "+e.message); return; }
    setDecoding(false);
    const ctx=getCtx(); if (ctx.state==="suspended") await ctx.resume();
    const maxDur=Math.max(...activeSong.tracks.map(t=>decodedBufs.current[t.id]?.duration||0));
    durationRef.current=maxDur; setDuration(maxDur);
    const newAnalysers={},newSources={};
    activeSong.tracks.forEach(t=>{
      const buf=decodedBufs.current[t.id]; if (!buf) return;
      const src=ctx.createBufferSource(), an=ctx.createAnalyser(), gn=ctx.createGain();
      src.buffer=buf; an.fftSize=512;
      const muted=soloRef.current?soloRef.current!==t.id:!!mutedRef.current[t.id];
      const vol=(volumeRef.current[t.id]??100)/100;
      gn.gain.value=muted?0:vol;
      newAnalysers[t.id]=an;
    });
    sourcesRef.current=newSources; startedAtRef.current=ctx.currentTime;
    setAnalysers(newAnalysers); setIsPlaying(true);
    const MEAS=2.4;
    const tick=()=>{
      const elapsed=getCtx().currentTime-startedAtRef.current;
      setCurrentTime(Math.min(elapsed,durationRef.current));
      setCurrentMeasure(Math.floor(elapsed/MEAS));
      if (elapsed>=durationRef.current){stopAll();return;}
      rafRef.current=requestAnimationFrame(tick);
    };
    rafRef.current=requestAnimationFrame(tick);
  },[activeSong,stopAll]);

  const seekTo=useCallback(async(ratio)=>{
    if (!activeSong?.tracks.length||!durationRef.current) return;
    const was=isPlaying; stopAll(); if (!was) return;
    const ctx=getCtx(); if (ctx.state==="suspended") await ctx.resume();
    const offset=ratio*durationRef.current;
    const newAn={},newSrc={};
    activeSong.tracks.forEach(t=>{
      const buf=decodedBufs.current[t.id]; if (!buf) return;
      const src=ctx.createBufferSource(),an=ctx.createAnalyser(),gn=ctx.createGain();
      src.buffer=buf; an.fftSize=512;
      const muted=soloRef.current?soloRef.current!==t.id:!!mutedRef.current[t.id];
      const vol=(volumeRef.current[t.id]??100)/100;
      gn.gain.value=muted?0:vol;
      newSrc[t.id]={source:src,gainNode:gn,analyser:an}; newAn[t.id]=an;
    });
    sourcesRef.current=newSrc; startedAtRef.current=ctx.currentTime-offset;
    setAnalysers(newAn); setIsPlaying(true);
    const MEAS=2.4;
    const tick=()=>{
      const e=getCtx().currentTime-startedAtRef.current;
      setCurrentTime(Math.min(e,durationRef.current)); setCurrentMeasure(Math.floor(e/MEAS));
      if (e>=durationRef.current){stopAll();return;}
      rafRef.current=requestAnimationFrame(tick);
    };
    rafRef.current=requestAnimationFrame(tick);
  },[activeSong,isPlaying,stopAll]);

  const toggleMute=(id)=>{ if (soloTrack) return; const n={...mutedTracks,[id]:!mutedTracks[id]}; setMutedTracks(n); applyGains(n,null); };
  const toggleSolo=(id)=>{ const n=soloTrack===id?null:id; setSoloTrack(n); applyGains(mutedTracks,n); };

  useEffect(()=>()=>stopAll(),[]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const progressPct  = duration>0?Math.min((currentTime/duration)*100,100):0;
  const activeCount  = activeSong?.tracks.filter(t=>soloTrack?soloTrack===t.id:!mutedTracks[t.id]).length??0;
  const isConfigured = !!(SUPABASE_URL&&SUPABASE_ANON);

  // ── Song list component (shared between sidebar and mobile drawer) ─────────
  const SongList = ()=>(
    <>
      <div style={{padding:"0 14px 8px",fontSize:10,fontWeight:700,color:"#a8a29e",letterSpacing:".12em",textTransform:"uppercase"}}>Songs</div>
      {songs.length===0&&<div style={{padding:"10px 14px",fontSize:13,color:"#a8a29e",fontStyle:"italic"}}>No songs yet</div>}
      {songs.map(s=>(
        <div key={s.id} style={{display:"flex",alignItems:"center",
          background:activeSongId===s.id?"#fef3c7":"transparent",
          borderLeft:activeSongId===s.id?"3px solid #f59e0b":"3px solid transparent"}}>
          <button onClick={()=>{selectSong(s.id);setShowSidebar(false);}} style={{
            flex:1,textAlign:"left",padding:"11px 14px",border:"none",background:"transparent",
            cursor:"pointer",fontFamily:"Georgia,serif",minWidth:0}}>
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
      {addingSong?(
        <div style={{padding:"10px 14px"}}>
          <input autoFocus value={newTitle} onChange={e=>setNewTitle(e.target.value)}
            onKeyDown={e=>{if(e.key==="Enter")createSong();if(e.key==="Escape")setAddingSong(false);}}
            placeholder="Song title…"
            style={{width:"100%",padding:10,border:"1px solid #d6d3d1",borderRadius:8,
              fontSize:14,fontFamily:"Georgia,serif",marginBottom:8,outline:"none"}}/>
          <div style={{display:"flex",gap:6}}>
            <button onClick={createSong} style={{flex:1,padding:9,border:"none",borderRadius:8,
              background:"#f59e0b",color:"#fff",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif",fontWeight:600}}>Add</button>
            <button onClick={()=>setAddingSong(false)} style={{flex:1,padding:9,border:"1px solid #d6d3d1",
              borderRadius:8,background:"#fff",color:"#78716c",fontSize:13,cursor:"pointer",fontFamily:"Georgia,serif"}}>Cancel</button>
          </div>
        </div>
      ):(
        <button onClick={()=>setAddingSong(true)} style={{
          display:"block",width:"calc(100% - 28px)",margin:"8px 14px",padding:10,
          border:"1px dashed #d6d3d1",borderRadius:8,background:"transparent",
          cursor:"pointer",fontSize:13,color:"#78716c",fontFamily:"Georgia,serif"}}>+ New Song</button>
      )}
    </>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  if (appLoading) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",
      fontFamily:"Georgia,serif",color:"#a8a29e",gap:12,fontSize:15}}>
      <span style={{display:"inline-block",animation:"spin .8s linear infinite",fontSize:20}}>⟳</span>
      Loading songs…
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  return (
    <div style={{fontFamily:"Georgia,serif",background:"#fafaf8",minHeight:"100vh",color:"#1c1917"}}>
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.25}}
        *{box-sizing:border-box}
        input,button,select{-webkit-tap-highlight-color:transparent}
      `}</style>

      {/* ── Header ── */}
      <div style={{background:"#1c1917",padding:"13px 16px",display:"flex",alignItems:"center",
        justifyContent:"space-between",position:"sticky",top:0,zIndex:100}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {isMobile&&(
            <button onClick={()=>setShowSidebar(v=>!v)}
              style={{background:"transparent",border:"none",color:"#fafaf8",fontSize:20,cursor:"pointer",padding:"0 8px 0 0"}}>☰</button>
          )}
          <span style={{fontSize:22,color:"#fafaf8"}}>𝄞</span>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:"#fafaf8",letterSpacing:".02em"}}>ScoreView</div>
            {!isMobile&&<div style={{fontSize:9,color:"#a8a29e",letterSpacing:".12em",textTransform:"uppercase"}}>Score + Multi-Track Player</div>}
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <SaveBadge status={saveStatus}/>
          {activeSong&&isPlaying&&(
            <div style={{display:"flex",gap:4}}>
              {activeSong.tracks.map(t=>{
                const dim=soloTrack?soloTrack!==t.id:!!mutedTracks[t.id];
                return <div key={t.id} style={{width:6,height:6,borderRadius:"50%",
                  background:dim?"#555":t.color,boxShadow:!dim?`0 0 4px ${t.color}`:"none"}}/>;
              })}
            </div>
          )}
          {!isMobile&&<span style={{fontSize:11,color:"#78716c"}}>{songs.length} song{songs.length!==1?"s":""}</span>}
        </div>
      </div>

      {!isConfigured&&<NotConfigured/>}

      {/* ── Mobile drawer ── */}
      {isMobile&&showSidebar&&(
        <>
          <div onClick={()=>setShowSidebar(false)}
            style={{position:"fixed",inset:0,background:"rgba(0,0,0,.4)",zIndex:200}}/>
          <div style={{position:"fixed",top:0,left:0,bottom:0,width:280,background:"#fff",
            zIndex:201,overflowY:"auto",paddingTop:14,boxShadow:"4px 0 20px rgba(0,0,0,.15)"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"0 14px 12px"}}>
              <span style={{fontSize:15,fontWeight:700}}>𝄞 ScoreView</span>
              <button onClick={()=>setShowSidebar(false)}
                style={{background:"transparent",border:"none",fontSize:22,cursor:"pointer",color:"#78716c"}}>×</button>
            </div>
            <SongList/>
          </div>
        </>
      )}

      <div style={{display:"flex",minHeight:"calc(100vh - 52px)"}}>
        {/* ── Desktop sidebar ── */}
        {!isMobile&&(
          <div style={{width:220,background:"#fff",borderRight:"1px solid #e7e5e4",
            padding:"14px 0",flexShrink:0,overflowY:"auto"}}>
            <SongList/>
          </div>
        )}

        {/* ── Main ── */}
        <div style={{flex:1,padding:isMobile?"14px":"20px",overflowY:"auto",minWidth:0}}>
          {!activeSong?(
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",
              justifyContent:"center",minHeight:380,gap:14,color:"#a8a29e",padding:20}}>
              <div style={{fontSize:52,opacity:.2}}>𝄞</div>
              <div style={{fontSize:16,fontWeight:600,color:"#78716c",textAlign:"center"}}>No song selected</div>
              <div style={{fontSize:13,textAlign:"center"}}>
                {isMobile?"Tap ☰ to open the menu and create a song":"Create a new song in the sidebar"}
              </div>
              <button onClick={()=>isMobile?setShowSidebar(true):setAddingSong(true)}
                style={{marginTop:6,padding:"12px 24px",border:"1px solid #d6d3d1",borderRadius:8,
                  background:"#fff",cursor:"pointer",fontSize:14,fontFamily:"Georgia,serif"}}>+ New Song</button>
            </div>
          ):(<>

            {/* Title */}
            <div style={{marginBottom:16}}>
              <h2 style={{margin:"0 0 3px",fontSize:isMobile?18:21,fontWeight:700,
                whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{activeSong.title}</h2>
              <div style={{fontSize:12,color:"#a8a29e"}}>
                {activeSong.tracks.length} track{activeSong.tracks.length!==1?"s":""}
                {activeSong.scoreFile?` · 🎼 ${activeSong.scoreFile.name}`:""}
              </div>
            </div>

            {/* ── Transport ── */}
            <div style={{background:"#fff",border:"1px solid #e7e5e4",borderRadius:12,
              padding:isMobile?"12px 14px":"14px 18px",marginBottom:16}}>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
                <button onClick={isPlaying?stopAll:startPlayback}
                  disabled={!activeSong.tracks.length||decoding}
                  style={{width:isMobile?52:46,height:isMobile?52:46,borderRadius:"50%",border:"none",
                    flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",
                    fontSize:isMobile?20:17,color:"#fff",
                    background:activeSong.tracks.length&&!decoding?"#1c1917":"#e7e5e4",
                    cursor:activeSong.tracks.length&&!decoding?"pointer":"default"}}>
                  {decoding?<span style={{display:"inline-block",animation:"spin .8s linear infinite",fontSize:16}}>⟳</span>
                    :isPlaying?"⏹":"▶"}
                </button>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                    <span style={{fontSize:13,fontWeight:600,color:"#44403c",fontFamily:"monospace"}}>{formatTime(currentTime)}</span>
                    <span style={{fontSize:13,color:"#a8a29e",fontFamily:"monospace"}}>{formatTime(duration)}</span>
                  </div>
                  <div style={{height:isMobile?10:5,background:"#e7e5e4",borderRadius:5,
                    cursor:"pointer",position:"relative",userSelect:"none"}}
                    onClick={e=>{const r=e.currentTarget.getBoundingClientRect();seekTo((e.clientX-r.left)/r.width);}}>
                    <div style={{position:"absolute",top:0,left:0,height:"100%",background:"#f59e0b",
                      borderRadius:5,width:progressPct+"%",pointerEvents:"none",transition:"width .08s linear"}}/>
                  </div>
                </div>
              </div>
              <div style={{fontSize:11,color:decodeError?"#ef4444":"#a8a29e",fontStyle:"italic"}}>
                {decodeError?`⚠ ${decodeError}`:decoding?"Decoding audio…"
                  :!activeSong.tracks.length?"Add audio tracks below to enable playback"
                  :isPlaying?`Playing ${activeCount} of ${activeSong.tracks.length} track${activeSong.tracks.length!==1?"s":""}`
                  :"Press ▶ to play all tracks in sync"}
              </div>
            </div>

            {/* ── Tracks ── */}
            <div style={{marginBottom:20}}>
              <h3 style={{margin:"0 0 10px",fontSize:14,fontWeight:700,color:"#44403c"}}>
                Instrument Tracks
                {activeSong.tracks.length>0&&<span style={{fontSize:11,fontWeight:400,color:"#a8a29e",marginLeft:8}}>{activeSong.tracks.length} loaded</span>}
              </h3>

              {/* Two ways to add a track */}
              <div style={{display:"flex",gap:10,marginBottom:10,flexDirection:isMobile?"column":"row"}}>
                {/* Option 1: Upload */}
                <DropArea onFiles={handleTrackUpload}
                  accept="audio/*,.mp3,.wav,.ogg,.flac,.aac,.m4a,.opus" multiple color="#6366f1">
                  <div style={{padding:"6px 0"}}>
                    <div style={{fontSize:22,marginBottom:4,opacity:.5}}>📂</div>
                    <div style={{fontSize:13,fontWeight:600,color:"#44403c",marginBottom:2}}>
                      {isMobile?"Tap to upload audio":"Drop audio files"}
                    </div>
                    <div style={{fontSize:11,color:"#a8a29e"}}>MP3 · WAV · OGG · FLAC · M4A</div>
                  </div>
                </DropArea>

                {/* Option 2: Record new track inline */}
                <NewTrackRecorder
                  songId={activeSongId}
                  trackCount={activeSong.tracks.length}
                  onSaveRecording={handleSaveRecording}
                />
              </div>

              {activeSong.tracks.length>0&&(
                <div style={{fontSize:11,color:"#a8a29e",margin:"7px 0 10px",fontStyle:"italic"}}>
                  {activeSong.tracks.length} track{activeSong.tracks.length!==1?"s":""} — all play in sync · add more above
                </div>
              )}

              {activeSong.tracks.map((track,ti)=>{
                const isMuted=soloTrack?soloTrack!==track.id:!!mutedTracks[track.id];
                const isSolo=soloTrack===track.id;
                const icon=track.icon||TRACK_ICONS[ti%TRACK_ICONS.length];
                return (
                  <div key={track.id} style={{background:"#fff",
                    border:`1px solid ${!isMuted?track.color+"45":"#e7e5e4"}`,
                    borderRadius:12,marginBottom:10,overflow:"hidden",
                    opacity:isMuted?.42:1,transition:"opacity .2s,border-color .2s"}}>
                    <div style={{padding:"10px 14px",display:"flex",alignItems:"center",gap:10,
                      background:!isMuted?track.colorLight:"#f5f5f4",
                      borderBottom:`1px solid ${!isMuted?track.color+"20":"#e7e5e4"}`}}>
                      <span style={{width:10,height:10,borderRadius:"50%",flexShrink:0,
                        background:!isMuted?track.color:"#d6d3d1",
                        animation:!isMuted&&isPlaying?"pulse 1.2s ease-in-out infinite":"none",
                        boxShadow:!isMuted&&isPlaying?`0 0 5px ${track.color}`:"none"}}/>
                      <select value={icon} onChange={e=>changeTrackIcon(track.id,e.target.value)}
                        style={{border:"none",background:"transparent",fontSize:18,cursor:"pointer",padding:0,outline:"none",flexShrink:0}}>
                        {["🎹","🎻","🎺","🥁","🎸","🎷","🎤","🪗","🎵","🎼","🎶"].map(i=>(
                          <option key={i} value={i}>{i}</option>
                        ))}
                      </select>
                      <input value={track.name} onChange={e=>renameTrack(track.id,e.target.value)}
                        style={{flex:1,border:"none",background:"transparent",fontSize:14,fontWeight:600,
                          color:"#1c1917",fontFamily:"Georgia,serif",outline:"none",minWidth:0}}/>
                      <span style={{fontSize:10,padding:"2px 7px",borderRadius:4,background:track.color,
                        color:"#fff",fontWeight:700,flexShrink:0}}>#{ti+1}</span>
                      <button onClick={()=>removeTrack(track.id)}
                        style={{fontSize:18,padding:"0 4px",border:"none",background:"transparent",
                          cursor:"pointer",color:"#d6d3d1",lineHeight:1,flexShrink:0}}>×</button>
                    </div>
                    <div style={{padding:"8px 14px 6px"}}>
                      <WaveBar analyser={analysers[track.id]} color={track.color} active={!isMuted&&isPlaying}/>
                    </div>

                    {/* Volume slider */}
                    <div style={{padding:"2px 14px 8px",display:"flex",alignItems:"center",gap:10}}>
                      <span style={{fontSize:14,flexShrink:0}} title="Volume">
                        {(trackVolumes[track.id]??100)===0?"🔈":(trackVolumes[track.id]??100)<50?"🔉":"🔊"}
                      </span>
                      <input
                        type="range" min={0} max={100} step={1}
                        value={trackVolumes[track.id]??100}
                        onChange={e=>changeTrackVolume(track.id, Number(e.target.value))}
                        style={{
                          flex:1, height:4, borderRadius:2, outline:"none", cursor:"pointer",
                          accentColor: track.color,
                          background:`linear-gradient(to right, ${track.color} ${trackVolumes[track.id]??100}%, #e7e5e4 ${trackVolumes[track.id]??100}%)`,
                        }}
                      />
                      <span style={{fontSize:12,fontFamily:"monospace",color:"#78716c",
                        flexShrink:0,minWidth:32,textAlign:"right"}}>
                        {trackVolumes[track.id]??100}%
                      </span>
                    </div>
                    <div style={{padding:"6px 14px 10px",display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
                      <button onClick={()=>toggleMute(track.id)} disabled={!!soloTrack}
                        style={{flex:1,minWidth:80,padding:"9px 12px",borderRadius:8,fontWeight:600,fontSize:13,
                          cursor:soloTrack?"default":"pointer",
                          border:`1px solid ${mutedTracks[track.id]?"#ef4444":"#d6d3d1"}`,
                          background:mutedTracks[track.id]?"#fef2f2":"#fff",
                          color:mutedTracks[track.id]?"#ef4444":"#78716c",opacity:soloTrack?.35:1}}>
                        {mutedTracks[track.id]?"🔇 Muted":"🔊 Mute"}
                      </button>
                      <button onClick={()=>toggleSolo(track.id)}
                        style={{flex:1,minWidth:80,padding:"9px 12px",borderRadius:8,fontWeight:600,fontSize:13,cursor:"pointer",
                          border:`1px solid ${isSolo?track.color:"#d6d3d1"}`,
                          background:isSolo?track.color:"#fff",color:isSolo?"#fff":"#78716c"}}>
                        {isSolo?"★ Solo":"☆ Solo"}
                      </button>
                      <TrackRecorder
                        trackId={track.id}
                        trackColor={track.color}
                        trackName={track.name}
                        onSaveRecording={handleSaveRecording}
                      />
                      <div style={{fontSize:10,color:"#b0a9a0",fontStyle:"italic",
                        flex:isMobile?"1 1 100%":"1",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
                        {track.file?.name||track.audioUrl?.split("/").pop()||""}
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
                  <button onClick={removeScore}
                    style={{fontSize:12,padding:"6px 12px",border:"1px solid #d6d3d1",borderRadius:7,
                      background:"#fff",color:"#78716c",cursor:"pointer"}}>× Remove</button>
                )}
              </div>
              {activeSong.scoreFile?(
                <div style={{background:"#fff",border:"1px solid #e7e5e4",borderRadius:10,padding:12,overflowX:"auto"}}>
                  <OsmdViewer xmlContent={activeSong.scoreFile.xmlContent} currentMeasure={currentMeasure}/>
                </div>
              ):(
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

            <div style={{padding:"12px 14px",background:"#fef3c7",borderRadius:10,
              fontSize:12,color:"#92400e",lineHeight:1.7,marginBottom:20}}>
              <strong>Tip:</strong> Upload one audio file per instrument — they play in sync.
              <strong> Mute</strong> silences one, <strong>Solo</strong> isolates it.
              {isConfigured?" Songs and audio are saved to the cloud automatically.":" Configure Supabase to enable cloud saving."}
            </div>

          </>)}
        </div>
      </div>
    </div>
  );
}
