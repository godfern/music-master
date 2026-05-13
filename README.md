# ScoreView — Multi-Voice Music Player

Upload a music score (MusicXML) and audio files (one per instrument) and play them together with mute/solo per track.

## Features
- Multi-track audio playback (all instruments in sync)
- MusicXML score display via OpenSheetMusicDisplay (OSMD)
- Mute / Solo per instrument track
- Live waveform visualiser per track
- Seekable progress bar
- Multiple songs

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173

## Deploy to Vercel (free, recommended)

```bash
npm install -g vercel
vercel
```

Or connect your GitHub repo at vercel.com — it auto-deploys on every push.

## Deploy to Netlify (free)

```bash
npm install -g netlify-cli
netlify deploy --prod
```

Or drag the `dist/` folder to netlify.com/drop after running:

```bash
npm run build
```

## Deploy to GitHub Pages

```bash
npm run build
# then push the dist/ folder to your gh-pages branch
```

Add `base: '/your-repo-name/'` to `vite.config.js` if hosting in a subdirectory.

## File formats supported
- **Score:** .xml, .mxl, .musicxml (MusicXML)
- **Audio:** MP3, WAV, OGG, FLAC, AAC, M4A, Opus
