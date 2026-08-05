/* ── Cosmoscope · capture.js ────────────────────────────────────────
   Still export (up to 8K via the engine's tiled ray-trace) and video
   recording via MediaRecorder. MP4 is preferred where the platform
   can mux it (Chrome 126+, Safari 14.1+); WebM VP9/VP8 is the
   universal fallback (Firefox). The candidate order below was
   verified against 2025-2026 browser support.                      */

export const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01E,opus',
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=vp9,opus',
  'video/mp4;codecs=vp9',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp8',
  'video/webm',
];

export function supportedMimes() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return [];
  return MIME_CANDIDATES.filter((m) => {
    try { return MediaRecorder.isTypeSupported(m); } catch { return false; }
  });
}

export function bestMime(preference = 'auto') {
  const ok = supportedMimes();
  if (!ok.length) return null;
  if (preference === 'mp4') return ok.find((m) => m.startsWith('video/mp4')) || ok[0];
  if (preference === 'webm') return ok.find((m) => m.startsWith('video/webm')) || ok[0];
  return ok[0];
}

export function extOf(mime) {
  return mime && mime.startsWith('video/mp4') ? 'mp4' : 'webm';
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  /* keep the URL alive briefly so the click lands, then release */
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return url;
}

/* ── stills ── */
export async function captureStill(engine, frame, opts) {
  const { res, mime, quality, onProgress } = opts;
  let canvas;
  let label;
  if (res === 'screen') {
    engine.render(frame);              /* fresh frame in the same task */
    canvas = engine.canvas;
    label = `${canvas.width}x${canvas.height}`;
  } else {
    const w = parseInt(res, 10);
    const h = Math.round(w * 9 / 16);
    label = { 1920: 'fullhd', 2560: 'qhd', 3840: '4k', 7680: '8k' }[w] || `${w}x${h}`;
    canvas = await engine.renderStill(w, h, frame, onProgress);
    if (!canvas || canvas.width !== w || canvas.height !== h) {
      const err = new Error('canvas limit');
      err.kind = 'toobig';
      throw err;
    }
  }
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
  if (!blob) {
    const err = new Error('encode failed');
    err.kind = 'toobig';
    throw err;
  }
  /* Safari has no WebP encoder and silently falls back to PNG */
  const actualExt = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[blob.type] || 'png';
  return { blob, name: `cosmoscope-${label}-${stamp()}.${actualExt}` };
}

/* ── video ── */
export class Recorder {
  constructor(canvas) {
    this.canvas = canvas;
    this.rec = null;
    this.chunks = [];
    this.startedAt = 0;
  }

  get supported() { return supportedMimes().length > 0; }
  get recording() { return !!this.rec && this.rec.state === 'recording'; }

  start({ preference = 'auto', fps = 60, mbps = 16, audioEngine = null }) {
    const ok = supportedMimes();
    if (!ok.length) {
      const err = new Error('unsupported');
      err.kind = 'unsupported';
      throw err;
    }
    let pool = preference === 'mp4' ? ok.filter((m) => m.startsWith('video/mp4'))
      : preference === 'webm' ? ok.filter((m) => m.startsWith('video/webm')) : ok;
    if (!pool.length) pool = ok;
    /* pair the container's declared codecs with the tracks we'll add:
       a mime naming an audio codec but no audio track (or vice versa)
       is rejected by stricter platforms */
    const hasAudioCodec = (m) => m.includes('mp4a') || m.includes('opus');
    const liveAudio = !!(audioEngine && audioEngine.started && !audioEngine.muted);
    let mime = liveAudio
      ? (pool.find(hasAudioCodec) || pool.find((m) => !m.includes('codecs')))
      : pool.find((m) => !hasAudioCodec(m));
    mime = mime || pool[0];
    const stream = this.canvas.captureStream(fps);
    const wantsAudio = liveAudio && (hasAudioCodec(mime) || !mime.includes('codecs'));
    if (wantsAudio) {
      try {
        const dest = audioEngine.ctx.createMediaStreamDestination();
        audioEngine.master.connect(dest);
        for (const track of dest.stream.getAudioTracks()) stream.addTrack(track);
        this._audioTap = { engine: audioEngine, dest };
      } catch { /* video-only recording is fine */ }
    }
    this.chunks = [];
    this.rec = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: mbps * 1e6,
    });
    this.rec.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.rec.start(1000);
    this.startedAt = Date.now();
    this.mime = mime;
    return mime;
  }

  elapsed() {
    return this.recording ? (Date.now() - this.startedAt) / 1000 : 0;
  }

  stop() {
    return new Promise((resolve, reject) => {
      if (!this.rec) { reject(new Error('not recording')); return; }
      const rec = this.rec;
      rec.onstop = () => {
        const type = this.mime.split(';')[0];
        const blob = new Blob(this.chunks, { type });
        const name = `cosmoscope-${stamp()}.${extOf(this.mime)}`;
        if (this._audioTap) {
          try { this._audioTap.engine.master.disconnect(this._audioTap.dest); } catch { /* already gone */ }
          this._audioTap = null;
        }
        this.rec = null;
        this.chunks = [];
        resolve({ blob, name });
      };
      rec.onerror = (e) => { this.rec = null; reject(e.error || new Error('recorder error')); };
      rec.stop();
    });
  }
}
