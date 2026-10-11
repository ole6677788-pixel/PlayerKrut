'use strict';
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = value => { const s = Math.max(0, Math.floor(Number(value) || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };

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
 const sec = Math.floor(position), d = Math.floor(dur);
 dom.title.setAttribute('aria-valuenow', String(sec));
 dom.title.setAttribute('aria-valuemax', String(d));
 dom.title.setAttribute('aria-valuetext', fmt(position) + (dur > 0 ? ' / ' + fmt(dur) : ''));
 dom.title.classList.toggle('no-seek', !(dur > 0));
}

let wantedCover = '';
dom.art.addEventListener('load', () => {
 if (dom.art.getAttribute('src') !== wantedCover || !wantedCover) return;
 dom.art.style.display = 'block';
 dom.orbWrap.classList.add('has-cover');
 dom.shell.style.setProperty('--cover-image', 'url("' + wantedCover.replace(/"/g, '%22') + '")');
});
dom.art.addEventListener('error', () => {
 if (dom.art.getAttribute('src') !== wantedCover) return;
 clearCover();
});
function clearCover() {
 wantedCover = '';
 dom.art.removeAttribute('src');
 dom.art.style.display = 'none';
 dom.orbWrap.classList.remove('has-cover');
 dom.shell.style.setProperty('--cover-image', 'none');
}
function setCover(src) {
 if (!src) { if (wantedCover || dom.art.hasAttribute('src')) clearCover(); return; }
 if (src === wantedCover) return;
 wantedCover = src;
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
 setText(dom.title, has ? title : 'Ничего не играет');
 const appName = String(d.app || '').split('!')[0].split('.').pop();
 let artistText;
 if (has) {
  artistText = artist || (d.album ? String(d.album).trim() : '') || 'Неизвестный исполнитель';
 } else if (d.error) {
  artistText = String(d.error);
 } else if (appName) {
  artistText = '«' + appName + '» не передал название';
 } else {
  artistText = 'Запусти музыку';
 }
 setText(dom.artist, artistText);
 setText(dom.playpause, playing ? 'Ⅱ' : '▶');
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
  setCover('');
 } else if (d.thumbnail) {
  const src = coverSource(d);
  if (src) {
   state.coverId = cid;
   setCover(src);
  }
 } else if (cid === 0 && state.coverId !== 0) {
  state.coverId = 0;
  setCover('');
 }
}
async function update() {
 if (state.busy || document.hidden) return;
 state.busy = true;
 try {
  const d = await window.playerAPI.getNowPlaying(state.coverId);
  applyNowPlaying(d || {});
 } catch (error) {
  setText(dom.title, 'Музыка пока не найдена');
  setText(dom.artist, 'Windows: ' + String(error && error.message || 'не удалось прочитать данные'));
  clearCover(); state.coverId = 0;
 } finally { state.busy = false; }
}
async function control(action, position) {
 let result;
 try { result = await window.playerAPI.control(action, position); }
 catch (error) { result = { ok: false, message: String(error && error.message || error) }; }
 setTimeout(update, 450);
 return result;
}

$('previous').onclick = () => control('previous');
$('playpause').onclick = () => control('playpause');
$('next').onclick = () => control('next');
$('close').onclick = () => window.playerAPI.close();
$('min').onclick = () => window.playerAPI.minimize();
$('pin').onclick = () => window.playerAPI.togglePin();

async function commitSeek(target) {
 state.basePosition = target; state.baseStamp = Date.now();
 state.ignorePollUntil = Date.now() + 1500;
 renderProgress(target);
 const result = await control('seek', target);
 if (!result || !result.ok) {
  state.ignorePollUntil = 0;
 }
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
grip.addEventListener('lostpointercapture', stopResize);

const audio = { ctx: null, stream: null, source: null, analyser: null, sink: null, data: null, state: 'idle', starting: null, retries: 0, retryTimer: 0, gestureTried: false };
function setBassUi(kind) {}
function stopAudio() {
 const { source, analyser, sink, stream, ctx } = audio;
 clearTimeout(audio.retryTimer);
 for (const node of [source, analyser, sink]) { try { node && node.disconnect(); } catch (_) {} }
 if (stream) stream.getTracks().forEach(track => { track.onended = null; try { track.stop(); } catch (_) {} });
 if (ctx) { ctx.onstatechange = null; if (ctx.state !== 'closed') ctx.close().catch(() => {}); }
 audio.ctx = audio.stream = audio.source = audio.analyser = audio.sink = audio.data = null;
 audio.state = 'idle';
 agc.init = false;
}
async function acquireStream() {
 try {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  if (stream.getAudioTracks().length) return stream;
  stream.getTracks().forEach(track => track.stop());
 } catch (error) { console.warn('getDisplayMedia loopback failed:', error); }
 const info = await window.playerAPI.getAudioLoopbackSource();
 if (!info || !info.sourceId) throw new Error(info && info.error || 'нет источника звука');
 return navigator.mediaDevices.getUserMedia({
  audio: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: info.sourceId } },
  video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: info.sourceId } }
 });
}
function onAudioLost() {
 stopAudio();
 setBassUi('unavailable');
 if (audio.retries < 3) {
  audio.retries++;
  audio.retryTimer = setTimeout(startAudio, 5000 * audio.retries);
 }
}
function startAudio() {
 if (audio.state === 'live') return Promise.resolve(true);
 if (audio.starting) return audio.starting;
 audio.starting = (async () => {
  setBassUi('connecting');
  try {
   const stream = await acquireStream();
   audio.stream = stream;
   stream.getVideoTracks().forEach(track => { track.stop(); stream.removeTrack(track); });
   const track = stream.getAudioTracks()[0];
   if (!track) throw new Error('в потоке нет звуковой дорожки');
   const ctx = new AudioContext({ latencyHint: 'playback' });
   audio.ctx = ctx;
   if (ctx.state === 'suspended') await ctx.resume();
   audio.source = ctx.createMediaStreamSource(stream);
   audio.analyser = ctx.createAnalyser();
   audio.analyser.fftSize = 2048;
   audio.analyser.smoothingTimeConstant = .6;
   audio.analyser.minDecibels = -85;
   audio.analyser.maxDecibels = -25;
   audio.sink = ctx.createGain();
   audio.sink.gain.value = 0;
   audio.source.connect(audio.analyser);
   audio.analyser.connect(audio.sink);
   audio.sink.connect(ctx.destination);
   audio.data = new Uint8Array(audio.analyser.frequencyBinCount);
   track.onended = onAudioLost;
   ctx.onstatechange = () => { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); };
   audio.state = 'live';
   audio.retries = 0;
   setBassUi('live');
   return true;
  } catch (error) {
   console.warn('System audio capture unavailable:', error);
   stopAudio();
   setBassUi('unavailable');
   return false;
  } finally { audio.starting = null; }
 })();
 return audio.starting;
}
window.addEventListener('pointerdown', () => {
 if (audio.state !== 'live' && !audio.starting && !audio.gestureTried) { audio.gestureTried = true; startAudio(); }
}, { passive: true });
window.addEventListener('beforeunload', stopAudio);

const agc = { init: false, hi: 0, lo: 0 };
function sampleBass(dt) {
 if (audio.state !== 'live' || !audio.analyser || !state.playing) { agc.init = false; return 0; }
 audio.analyser.getByteFrequencyData(audio.data);
 const hzPerBin = audio.ctx.sampleRate / audio.analyser.fftSize;
 const low = Math.max(1, Math.floor(35 / hzPerBin));
 const high = Math.min(audio.data.length - 1, Math.ceil(170 / hzPerBin));
 let sum = 0, peak = 0, count = 0;
 for (let i = low; i <= high; i++) { const v = audio.data[i] / 255; sum += v; if (v > peak) peak = v; count++; }
 const raw = count ? (sum / count) * .65 + peak * .35 : 0;
 if (!agc.init) { agc.hi = raw; agc.lo = raw; agc.init = true; }
 agc.hi = Math.max(raw, agc.hi - dt * .06);
 agc.lo = Math.min(raw, agc.lo + dt * .04);
 if (raw < .05) return 0;
 const n = clamp((raw - agc.lo) / Math.max(.14, agc.hi - agc.lo), 0, 1);
 return n * n;
}

const aurora = (() => {
  const canvas = $('aurora'), ctx = canvas.getContext('2d');
  const SCALE = 0.55, POINTS = 96;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let w = 1, h = 1, raf = 0, last = 0, t = 0, level = 0;
  function resize() {
    const r = canvas.getBoundingClientRect();
    const nw = Math.max(1, Math.round(r.width * SCALE));
    const nh = Math.max(1, Math.round(r.height * SCALE));
    if (canvas.width !== nw) canvas.width = nw;
    if (canvas.height !== nh) canvas.height = nh;
    w = nw; h = nh;
  }
  function pathMain(grow) {
    const cx = w * 0.58 + Math.sin(t * 0.11) * w * 0.03;
    const cy = h * 0.42 + Math.cos(t * 0.09) * h * 0.025;
    const baseR = Math.min(w, h) * (0.52 + level * 0.08) * grow;
    const rx = baseR * (1.05 + Math.sin(t * 0.07) * 0.06);
    const ry = baseR * (0.92 + Math.cos(t * 0.08) * 0.05);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.sin(t * 0.06) * 0.12);
    ctx.beginPath();
    for (let i = 0; i <= POINTS; i++) {
      const a = (i / POINTS) * Math.PI * 2;
      const wave =
        Math.sin(a * 2 + t * 0.55) * 0.14 +
        Math.sin(a * 3 - t * 0.38) * 0.09 +
        Math.sin(a * 5 + t * 0.22) * 0.055 +
        Math.sin(a * 7 - t * 0.15) * 0.03;
      const boost = 1 + level * 0.9;
      const px = Math.cos(a) * rx * (1 + wave * boost);
      const py = Math.sin(a) * ry * (1 + wave * boost * 0.9);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    return { cx, cy, rx, ry };
  }
  function frame(now) {
    raf = 0;
    if (document.hidden) return;
    const interval = state.playing ? 0 : 45;
    if (now - last < interval) { raf = requestAnimationFrame(frame); return; }
    const dt = Math.min(0.1, Math.max(0.001, (now - last) / 1000));
    last = now;
    const target = sampleBass(dt);
    level += (target - level) * (1 - Math.pow(1 - (target > level ? 0.4 : 0.08), dt * 60));
    t += dt * (state.playing ? 0.9 : 0.4) * (reduce ? 0.25 : 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    pathMain(1.35);
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.min(w, h) * 0.7);
    glow.addColorStop(0, 'rgba(220, 40, 70, ' + (0.18 + level * 0.25) + ')');
    glow.addColorStop(0.5, 'rgba(160, 20, 50, ' + (0.08 + level * 0.12) + ')');
    glow.addColorStop(1, 'rgba(40, 0, 15, 0)');
    ctx.fillStyle = glow;
    ctx.fill();
    ctx.restore();
    pathMain(1);
    const R = Math.min(w, h) * 0.55;
    const g = ctx.createRadialGradient(-R * 0.25, -R * 0.15, 0, 0, 0, R * 1.15);
    g.addColorStop(0,   'rgba(255, 90, 120, ' + (0.95 + level * 0.05) + ')');
    g.addColorStop(0.25,'rgba(220, 35, 70, 0.97)');
    g.addColorStop(0.55,'rgba(160, 15, 45, 0.95)');
    g.addColorStop(0.8, 'rgba(70, 5, 20, 0.9)');
    g.addColorStop(1,   'rgba(15, 0, 5, 0)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
    ctx.globalCompositeOperation = 'lighter';
    const coreR = Math.min(w, h) * (0.22 + level * 0.12);
    const cx = w * 0.58, cy = h * 0.40;
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
    core.addColorStop(0, 'rgba(255, 140, 170, ' + (0.22 + level * 0.45) + ')');
    core.addColorStop(0.5, 'rgba(255, 80, 110, ' + (0.08 + level * 0.2) + ')');
    core.addColorStop(1, 'rgba(255, 60, 90, 0)');
    ctx.fillStyle = core;
    ctx.fillRect(0, 0, w, h);
    raf = requestAnimationFrame(frame);
  }
  function start() { if (!raf && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } }
  function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
  if (typeof ResizeObserver === 'function') new ResizeObserver(resize).observe(canvas);
  else window.addEventListener('resize', resize);
  resize();
  return { start, stop };
})();

document.addEventListener('visibilitychange', () => {
 if (document.hidden) aurora.stop(); else { aurora.start(); update(); }
});

aurora.start();
startAudio();
update();
setInterval(update, 1800);
setInterval(() => { if (!state.dragging && !document.hidden) renderProgress(currentPosition()); }, 200);
