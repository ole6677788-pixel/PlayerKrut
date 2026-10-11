'use strict';
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = value => { const s = Math.max(0, Math.floor(Number(value) || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const setText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };

const dom = {
  shell: $('shell'), title: $('title'), artist: $('artist'),
  art: $('art'), orbWrap: $('orbWrap'), playpause: $('playpause')
};
const state = {
  busy: false, dragging: false, playing: false,
  basePosition: 0, baseDuration: 0, baseStamp: Date.now(), basePlaying: false,
  seekTarget: 0, ignorePollUntil: 0, coverId: 0
};

function currentPosition() {
  const raw = state.basePosition + (state.basePlaying ? (Date.now() - state.baseStamp) / 1000 : 0);
  return state.baseDuration > 0 ? clamp(raw, 0, state.baseDuration) : Math.max(0, raw);
}
let lastPct = '';
function renderProgress(position) {
  const dur = state.baseDuration;
  const pct = (dur > 0 ? clamp(position / dur * 100, 0, 100) : 0).toFixed(2) + '%';
  if (pct !== lastPct) { dom.title.style.setProperty('--track-progress', pct); lastPct = pct; }
  dom.title.classList.toggle('no-seek', !(dur > 0));
}

/* ---- COVER ---- */
let wantedCover = '';
function clearCover() {
  wantedCover = '';
  dom.art.removeAttribute('src');
  dom.art.style.display = 'none';
  dom.orbWrap.classList.remove('has-cover');
}
function setCover(src) {
  if (!src) { clearCover(); return; }
  if (src === wantedCover && dom.art.style.display === 'block') return;
  wantedCover = src;
  dom.art.onload = () => {
    if (dom.art.getAttribute('src') !== wantedCover) return;
    dom.art.style.display = 'block';
    dom.orbWrap.classList.add('has-cover');
  };
  dom.art.onerror = () => { if (dom.art.getAttribute('src') === wantedCover) clearCover(); };
  dom.art.src = src;
}
function coverSource(d) {
  const t = String(d.thumbnail || '');
  if (!t) return '';
  return t.startsWith('data:') ? t : 'data:' + (d.thumbnailType || 'image/jpeg') + ';base64,' + t;
}

function applyNowPlaying(d) {
  const title = String(d.title || '').trim();
  const artist = String(d.artist || '').trim();
  const has = !!title;
  const playing = !!d.playing;
  const now = Date.now();
  state.playing = playing;
  dom.shell.classList.toggle('idle', !playing);
  dom.orbWrap.classList.toggle('playing', playing);

  setText(dom.title, has ? title : '\u041d\u0438\u0447\u0435\u0433\u043e \u043d\u0435 \u0438\u0433\u0440\u0430\u0435\u0442');
  const appName = String(d.app || '').split('!')[0].split('.').pop();
  let artistText;
  if (has) artistText = artist || (d.album ? String(d.album).trim() : '') || '\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u044b\u0439 \u0438\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c';
  else if (d.error) artistText = String(d.error);
  else if (appName) artistText = '\u00ab' + appName + '\u00bb \u043d\u0435 \u043f\u0435\u0440\u0435\u0434\u0430\u043b \u043d\u0430\u0437\u0432\u0430\u043d\u0438\u0435';
  else artistText = '\u0417\u0430\u043f\u0443\u0441\u0442\u0438 \u043c\u0443\u0437\u044b\u043a\u0443';
  setText(dom.artist, artistText);
  setText(dom.playpause, playing ? '\u2161' : '\u25b6');

  if (playing !== state.basePlaying) {
    state.basePosition = currentPosition(); state.baseStamp = now; state.basePlaying = playing;
  }
  state.baseDuration = Math.max(0, Number(d.duration) || 0);
  if (!state.dragging && now >= state.ignorePollUntil) {
    state.basePosition = Math.max(0, Number(d.position) || 0);
    state.baseStamp = now;
  }
  if (!state.dragging) renderProgress(currentPosition());

  const cid = Number(d.coverId) || 0;
  if (!has) {
    state.coverId = 0;
    clearCover();
  } else if (d.thumbnail) {
    const src = coverSource(d);
    if (src) {
      state.coverId = cid || state.coverId || 1;
      setCover(src);
    }
  } else if (cid > 0 && cid !== state.coverId) {
    state.coverId = cid;
  }
}

async function update() {
  if (state.busy || document.hidden) return;
  state.busy = true;
  try {
    const d = await window.playerAPI.getNowPlaying(state.coverId);
    applyNowPlaying(d || {});
  } catch (error) {
    setText(dom.title, '\u041c\u0443\u0437\u044b\u043a\u0430 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u0430');
    setText(dom.artist, String(error && error.message || '\u043e\u0448\u0438\u0431\u043a\u0430'));
    clearCover(); state.coverId = 0;
  } finally { state.busy = false; }
}
async function control(action, position) {
  let result;
  try { result = await window.playerAPI.control(action, position); }
  catch (error) { result = { ok: false }; }
  setTimeout(update, 400);
  return result;
}

$('previous').onclick = () => control('previous');
$('playpause').onclick = () => control('playpause');
$('next').onclick = () => control('next');
$('close').onclick = () => window.playerAPI.close();
$('min').onclick = () => window.playerAPI.minimize();
$('pin').onclick = () => window.playerAPI.togglePin();
$('openapp').onclick = async () => {
  const btn = $('openapp');
  const r = await window.playerAPI.openSourceApp();
  btn.textContent = r && r.ok ? '\u2713' : '\u2197';
  setTimeout(() => { btn.textContent = '\u2197'; }, 1500);
};
$('version').onclick = () => alert('PlayerKrut v1.14.0\nARGB blob \u00b7 cover \u00b7 Yandex-style');

async function commitSeek(target) {
  state.basePosition = target; state.baseStamp = Date.now();
  state.ignorePollUntil = Date.now() + 1500;
  renderProgress(target);
  const result = await control('seek', target);
  if (!result || !result.ok) state.ignorePollUntil = 0;
}
function seekFromPointer(event) {
  const rect = dom.title.getBoundingClientRect();
  const fraction = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
  state.seekTarget = Math.round(state.baseDuration * fraction);
  renderProgress(state.seekTarget);
}
dom.title.addEventListener('pointerdown', event => {
  if (state.baseDuration <= 0 || (event.pointerType === 'mouse' && event.button !== 0)) return;
  state.dragging = true;
  try { dom.title.setPointerCapture(event.pointerId); } catch (_) {}
  seekFromPointer(event); event.preventDefault();
});
dom.title.addEventListener('pointermove', event => { if (state.dragging) seekFromPointer(event); });
function endDrag(event, commit) {
  if (!state.dragging) return;
  try { dom.title.releasePointerCapture(event.pointerId); } catch (_) {}
  state.dragging = false;
  if (commit) commitSeek(state.seekTarget);
  else { state.ignorePollUntil = 0; renderProgress(currentPosition()); update(); }
}
dom.title.addEventListener('pointerup', event => endDrag(event, true));
dom.title.addEventListener('pointercancel', event => endDrag(event, false));

const grip = $('resizeGrip');
let resizing = false, startX = 0, startY = 0, startW = 0, startH = 0, resizeFrame = 0;
grip.addEventListener('pointerdown', event => {
  resizing = true; startX = event.screenX; startY = event.screenY;
  const bounds = dom.shell.getBoundingClientRect(); startW = bounds.width; startH = bounds.height;
  try { grip.setPointerCapture(event.pointerId); } catch (_) {}
  event.preventDefault(); event.stopPropagation();
});
grip.addEventListener('pointermove', event => {
  if (!resizing) return;
  const width = clamp(startW + event.screenX - startX, 260, 720);
  const height = clamp(startH + event.screenY - startY, 200, 580);
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => window.playerAPI.resizeTo(width, height));
});
const stopResize = () => { resizing = false; };
grip.addEventListener('pointerup', stopResize);
grip.addEventListener('pointercancel', stopResize);

const audio = { ctx: null, stream: null, source: null, analyser: null, sink: null, data: null, state: 'idle', starting: null, retries: 0, retryTimer: 0, gestureTried: false };
function stopAudio() {
  const { source, analyser, sink, stream, ctx } = audio;
  clearTimeout(audio.retryTimer);
  for (const node of [source, analyser, sink]) { try { node && node.disconnect(); } catch (_) {} }
  if (stream) stream.getTracks().forEach(track => { track.onended = null; try { track.stop(); } catch (_) {} });
  if (ctx) { ctx.onstatechange = null; if (ctx.state !== 'closed') ctx.close().catch(() => {}); }
  audio.ctx = audio.stream = audio.source = audio.analyser = audio.sink = audio.data = null;
  audio.state = 'idle'; agc.init = false;
}
async function acquireStream() {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    if (stream.getAudioTracks().length) return stream;
    stream.getTracks().forEach(track => track.stop());
  } catch (_) {}
  const info = await window.playerAPI.getAudioLoopbackSource();
  if (!info || !info.sourceId) throw new Error('no audio');
  return navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: info.sourceId } },
    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: info.sourceId } }
  });
}
function onAudioLost() {
  stopAudio();
  if (audio.retries < 3) { audio.retries++; audio.retryTimer = setTimeout(startAudio, 5000 * audio.retries); }
}
function startAudio() {
  if (audio.state === 'live') return Promise.resolve(true);
  if (audio.starting) return audio.starting;
  audio.starting = (async () => {
    try {
      const stream = await acquireStream();
      audio.stream = stream;
      stream.getVideoTracks().forEach(track => { track.stop(); stream.removeTrack(track); });
      const track = stream.getAudioTracks()[0];
      if (!track) throw new Error('no track');
      const ctx = new AudioContext({ latencyHint: 'playback' });
      audio.ctx = ctx;
      if (ctx.state === 'suspended') await ctx.resume();
      audio.source = ctx.createMediaStreamSource(stream);
      audio.analyser = ctx.createAnalyser();
      audio.analyser.fftSize = 2048;
      audio.analyser.smoothingTimeConstant = 0.6;
      audio.sink = ctx.createGain();
      audio.sink.gain.value = 0;
      audio.source.connect(audio.analyser);
      audio.analyser.connect(audio.sink);
      audio.sink.connect(ctx.destination);
      audio.data = new Uint8Array(audio.analyser.frequencyBinCount);
      track.onended = onAudioLost;
      audio.state = 'live';
      audio.retries = 0;
      return true;
    } catch (e) {
      stopAudio();
      return false;
    } finally { audio.starting = null; }
  })();
  return audio.starting;
}
window.addEventListener('pointerdown', () => {
  if (audio.state !== 'live' && !audio.starting && !audio.gestureTried) { audio.gestureTried = true; startAudio(); }
}, { passive: true });

const agc = { init: false, hi: 0, lo: 0 };
function sampleBass(dt) {
  if (audio.state !== 'live' || !audio.analyser || !state.playing) { agc.init = false; return 0; }
  audio.analyser.getByteFrequencyData(audio.data);
  const hzPerBin = audio.ctx.sampleRate / audio.analyser.fftSize;
  const low = Math.max(1, Math.floor(35 / hzPerBin));
  const high = Math.min(audio.data.length - 1, Math.ceil(170 / hzPerBin));
  let sum = 0, peak = 0, count = 0;
  for (let i = low; i <= high; i++) { const v = audio.data[i] / 255; sum += v; if (v > peak) peak = v; count++; }
  const raw = count ? (sum / count) * 0.65 + peak * 0.35 : 0;
  if (!agc.init) { agc.hi = raw; agc.lo = raw; agc.init = true; }
  agc.hi = Math.max(raw, agc.hi - dt * 0.06);
  agc.lo = Math.min(raw, agc.lo + dt * 0.04);
  if (raw < 0.05) return 0;
  const n = clamp((raw - agc.lo) / Math.max(0.14, agc.hi - agc.lo), 0, 1);
  return n * n;
}

/* ARGB BLOB \u2014 like Yandex Music: large organic red form */
const aurora = (() => {
  const canvas = $('aurora');
  const ctx = canvas.getContext('2d');
  const SCALE = 0.6;
  const POINTS = 80;
  let w = 1, h = 1, raf = 0, last = 0, t = 0, level = 0;

  function resize() {
    const r = canvas.getBoundingClientRect();
    const nw = Math.max(1, Math.round(r.width * SCALE));
    const nh = Math.max(1, Math.round(r.height * SCALE));
    if (canvas.width !== nw) canvas.width = nw;
    if (canvas.height !== nh) canvas.height = nh;
    w = nw; h = nh;
  }

  function blobPath(cx, cy, rx, ry, time, intensity) {
    ctx.beginPath();
    for (let i = 0; i <= POINTS; i++) {
      const a = (i / POINTS) * Math.PI * 2;
      const wave =
        Math.sin(a * 2 + time * 0.7) * 0.18 +
        Math.sin(a * 3 - time * 0.45) * 0.12 +
        Math.sin(a * 4 + time * 0.3) * 0.07 +
        Math.sin(a * 5 - time * 0.2) * 0.04 +
        Math.cos(a * 1.5 + time * 0.25) * 0.08;
      const boost = 1 + intensity * 0.7;
      const px = Math.cos(a) * rx * (1 + wave * boost);
      const py = Math.sin(a) * ry * (1 + wave * boost * 0.85);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function frame(now) {
    raf = 0;
    if (document.hidden) return;
    const interval = state.playing ? 0 : 40;
    if (now - last < interval) { raf = requestAnimationFrame(frame); return; }
    const dt = Math.min(0.08, Math.max(0.001, (now - last) / 1000));
    last = now;

    const target = sampleBass(dt);
    level += (target - level) * (1 - Math.pow(1 - (target > level ? 0.35 : 0.07), dt * 60));
    t += dt * (state.playing ? 0.85 : 0.35);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const cx = w * 0.55 + Math.sin(t * 0.12) * w * 0.04;
    const cy = h * 0.40 + Math.cos(t * 0.09) * h * 0.03;
    const base = Math.min(w, h);
    const rx = base * (0.55 + level * 0.10);
    const ry = base * (0.48 + level * 0.08);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.sin(t * 0.08) * 0.15);
    blobPath(0, 0, rx * 1.45, ry * 1.4, t, level);
    const outer = ctx.createRadialGradient(0, 0, 0, 0, 0, base * 0.75);
    outer.addColorStop(0, 'rgba(230,50,80,' + (0.22 + level * 0.28) + ')');
    outer.addColorStop(0.45, 'rgba(180,25,55,' + (0.10 + level * 0.12) + ')');
    outer.addColorStop(1, 'rgba(40,0,10,0)');
    ctx.fillStyle = outer;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.sin(t * 0.08) * 0.15);
    blobPath(0, 0, rx, ry, t, level);
    const body = ctx.createRadialGradient(-rx * 0.2, -ry * 0.15, 0, 0, 0, Math.max(rx, ry) * 1.1);
    body.addColorStop(0,    'rgba(255,100,130,' + (0.95 + level * 0.05) + ')');
    body.addColorStop(0.22, 'rgba(230,40,75,0.97)');
    body.addColorStop(0.5,  'rgba(170,18,48,0.94)');
    body.addColorStop(0.75, 'rgba(80,8,25,0.85)');
    body.addColorStop(1,    'rgba(10,0,5,0)');
    ctx.fillStyle = body;
    ctx.fill();
    ctx.restore();

    ctx.globalCompositeOperation = 'lighter';
    const coreR = base * (0.18 + level * 0.14);
    const core = ctx.createRadialGradient(cx - rx * 0.1, cy - ry * 0.1, 0, cx, cy, coreR);
    core.addColorStop(0, 'rgba(255,150,175,' + (0.25 + level * 0.5) + ')');
    core.addColorStop(0.4, 'rgba(255,70,100,' + (0.1 + level * 0.2) + ')');
    core.addColorStop(1, 'rgba(255,50,80,0)');
    ctx.fillStyle = core;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';

    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (!raf && !document.hidden) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }
  function stop() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
  }

  if (typeof ResizeObserver === 'function') new ResizeObserver(resize).observe(canvas);
  else window.addEventListener('resize', resize);
  resize();
  return { start, stop };
})();

document.addEventListener('visibilitychange', () => {
  if (document.hidden) aurora.stop();
  else { aurora.start(); update(); }
});

aurora.start();
startAudio();
update();
setInterval(update, 1500);
setInterval(() => { if (!state.dragging && !document.hidden) renderProgress(currentPosition()); }, 200);
