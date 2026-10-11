'use strict';
const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const setText = (node, text) => { if (node && node.textContent !== text) node.textContent = text; };

const dom = {
  shell: $('shell'),
  title: $('title'),
  art: $('art'),
  coverWrap: $('coverWrap'),
  centerScene: $('centerScene'),
  bigPlay: $('bigPlay'),
  playpause: $('playpause')
};

const state = {
  busy: false, dragging: false, playing: false,
  basePosition: 0, baseDuration: 0, baseStamp: Date.now(), basePlaying: false,
  seekTarget: 0, ignorePollUntil: 0, coverId: 0
};

const settings = {
  bgMode: localStorage.getItem('pk_bg') || 'argb',  // argb | static | ambient
  staticColor: localStorage.getItem('pk_color') || '#00c8e0',
  glowBright: Number(localStorage.getItem('pk_glow') || 100)
};

const palette = { c0: [0, 200, 230], c1: [0, 140, 180], c2: [0, 60, 90], ready: false };

function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 200, 230];
}

function setPaletteFromRgb(c) {
  palette.c0 = [c[0], c[1], c[2]];
  palette.c1 = [Math.round(c[0] * 0.55), Math.round(c[1] * 0.55), Math.round(c[2] * 0.55)];
  palette.c2 = [Math.round(c[0] * 0.2), Math.round(c[1] * 0.2), Math.round(c[2] * 0.2)];
  document.documentElement.style.setProperty('--theme-color', `rgb(${c[0]}, ${c[1]}, ${c[2]})`);
}

function applyBgColor() {
  if (settings.bgMode === 'static' || settings.bgMode === 'argb') {
    setPaletteFromRgb(hexToRgb(settings.staticColor));
    return;
  }
  if (settings.bgMode === 'ambient') {
    if (palette.ready) return;
    setPaletteFromRgb([0, 200, 230]);
    return;
  }
}

function currentPosition() {
  const raw = state.basePosition + (state.basePlaying ? (Date.now() - state.baseStamp) / 1000 : 0);
  return state.baseDuration > 0 ? clamp(raw, 0, state.baseDuration) : Math.max(0, raw);
}

let lastPct = '';
function renderProgress(position) {
  const dur = state.baseDuration;
  const pct = (dur > 0 ? clamp(position / dur * 100, 0, 100) : 0).toFixed(2) + '%';
  if (pct !== lastPct) {
    dom.title.style.setProperty('--track-progress', pct);
    lastPct = pct;
  }
  dom.title.classList.toggle('no-seek', !(dur > 0));
}

let wantedCover = '';
function extractPalette(img) {
  if (settings.bgMode === 'static') return;
  try {
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0, 32, 32);
    const data = x.getImageData(0, 0, 32, 32).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const pr = data[i], pg = data[i+1], pb = data[i+2], a = data[i+3];
      if (a < 128) continue;
      const lum = 0.299*pr + 0.587*pg + 0.114*pb;
      if (lum < 25 || lum > 240) continue;
      const max = Math.max(pr, pg, pb), min = Math.min(pr, pg, pb);
      const sat = max === 0 ? 0 : (max - min) / max;
      if (sat > 0.25) { r += pr; g += pg; b += pb; n++; }
    }
    if (n > 4) {
      palette.c0 = [Math.round(r/n), Math.round(g/n), Math.round(b/n)];
      palette.c1 = [Math.round(palette.c0[0]*0.55), Math.round(palette.c0[1]*0.55), Math.round(palette.c0[2]*0.55)];
      palette.c2 = [Math.round(palette.c0[0]*0.2), Math.round(palette.c0[1]*0.2), Math.round(palette.c0[2]*0.2)];
      palette.ready = true;
      document.documentElement.style.setProperty('--theme-color', `rgb(${palette.c0[0]}, ${palette.c0[1]}, ${palette.c0[2]})`);
    }
  } catch (_) {}
}

function clearCover() {
  wantedCover = '';
  dom.art.removeAttribute('src');
  dom.art.style.display = 'none';
  dom.coverWrap.classList.remove('has-cover');
  palette.ready = false;
  applyBgColor();
}

function setCover(src) {
  if (!src) { clearCover(); return; }
  if (src === wantedCover && dom.art.style.display === 'block') return;
  wantedCover = src;
  dom.art.onload = () => {
    if (dom.art.getAttribute('src') !== wantedCover) return;
    dom.art.style.display = 'block';
    dom.coverWrap.classList.add('has-cover');
    extractPalette(dom.art);
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
  dom.shell.classList.toggle('playing', playing);

  let displayText;
  if (has) {
    displayText = artist ? (artist + ' — ' + title) : title;
  } else if (d.error) {
    displayText = String(d.error).slice(0, 40);
  } else {
    displayText = 'Ищем музыку…';
  }
  setText(dom.title, displayText);

  setText(dom.playpause, playing ? '⏸' : '▶');

  if (playing !== state.basePlaying) {
    state.basePosition = currentPosition();
    state.baseStamp = now;
    state.basePlaying = playing;
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
    setText(dom.title, 'Музыка не найдена');
    clearCover();
    state.coverId = 0;
  } finally {
    state.busy = false;
  }
}

async function control(action, position) {
  let result;
  try { result = await window.playerAPI.control(action, position); }
  catch (error) { result = { ok: false }; }
  setTimeout(update, 350);
  return result;
}

function pop(el) {
  if (!el) return;
  el.classList.remove('press-pop');
  void el.offsetWidth;
  el.classList.add('press-pop');
}

$('previous').onclick = () => { pop($('previous')); control('previous'); };
$('next').onclick = () => { pop($('next')); control('next'); };
$('playpause').onclick = () => { pop($('playpause')); control('playpause'); };
$('bigPlay').onclick = () => { pop($('bigPlay')); control('playpause'); };
const coverPlay = $('coverPlay');
if (coverPlay) {
  coverPlay.onclick = (e) => { e.stopPropagation(); pop(coverPlay); control('playpause'); };
}

$('close').onclick = () => window.playerAPI.close();
$('min').onclick = () => window.playerAPI.minimize();$('pin').onclick = () => window.playerAPI.togglePin();

// Modals: Changelog & Settings
const settingsOverlay = $('settingsOverlay');
const changelogOverlay = $('changelogOverlay');

function syncSettingsUI() {
  document.querySelectorAll('.s-mode[data-bg]').forEach(b => {
    b.classList.toggle('active', b.dataset.bg === settings.bgMode);
  });
  document.querySelectorAll('.color-swatch').forEach(b => {
    b.classList.toggle('active', b.dataset.color.toLowerCase() === settings.staticColor.toLowerCase());
  });
  const colorInput = $('staticColor');
  if (colorInput) colorInput.value = settings.staticColor;
  const gb = $('glowBright');
  const gv = $('glowBrightVal');
  if (gb) gb.value = settings.glowBright;
  if (gv) gv.textContent = settings.glowBright + '%';
  const sec = $('staticColorsSection');
  if (sec) sec.style.display = (settings.bgMode === 'static' || settings.bgMode === 'argb') ? 'block' : 'none';
}

$('settingsBtn').onclick = () => { settingsOverlay.classList.add('open'); syncSettingsUI(); };$('settingsClose').onclick = () => settingsOverlay.classList.remove('open');
settingsOverlay.addEventListener('click', e => { if (e.target === settingsOverlay) settingsOverlay.classList.remove('open'); });

$('versionFooter').onclick = () => { changelogOverlay.classList.add('open'); };$('changelogClose').onclick = () => changelogOverlay.classList.remove('open');
changelogOverlay.addEventListener('click', e => { if (e.target === changelogOverlay) changelogOverlay.classList.remove('open'); });

document.querySelectorAll('.s-mode[data-bg]').forEach(btn => {
  btn.onclick = () => {
    settings.bgMode = btn.dataset.bg;
    localStorage.setItem('pk_bg', settings.bgMode);
    syncSettingsUI();
    applyBgColor();
  };
});

document.querySelectorAll('.color-swatch').forEach(btn => {
  btn.onclick = () => {
    settings.staticColor = btn.dataset.color;
    localStorage.setItem('pk_color', settings.staticColor);
    syncSettingsUI();
    applyBgColor();
  };
});

$('staticColor').oninput = () => {
  settings.staticColor = $('staticColor').value;
  localStorage.setItem('pk_color', settings.staticColor);
  syncSettingsUI();
  applyBgColor();
};

$('glowBright').oninput = () => {
  settings.glowBright = Number($('glowBright').value);
  localStorage.setItem('pk_glow', settings.glowBright);
  $('glowBrightVal').textContent = settings.glowBright + '%';
};

applyBgColor();

$('openapp').onclick = async () => {
  const btn = $('openapp');
  const r = await window.playerAPI.openSourceApp();
  const old = btn.textContent;
  btn.textContent = r && r.ok ? '✓ Открыто' : 'Назад в приложение';
  setTimeout(() => { btn.textContent = old; }, 1400);
};

// Seek on track pill
async function commitSeek(target) {
  state.basePosition = target;
  state.baseStamp = Date.now();
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
  seekFromPointer(event);
  event.preventDefault();
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

// Correct Resize from any side (fixing left/top handles to expand correctly)
const MIN_W = 260, MIN_H = 200, MAX_W = 720, MAX_H = 580;
let resizing = false, resizeDir = '', startX = 0, startY = 0, startW = 0, startH = 0, startWinX = 0, startWinY = 0, resizeFrame = 0;

document.querySelectorAll('.rh').forEach(handle => {
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    resizing = true;
    resizeDir = handle.dataset.dir || 'se';
    startX = event.screenX;
    startY = event.screenY;
    const bounds = dom.shell.getBoundingClientRect();
    startW = bounds.width;
    startH = bounds.height;
    startWinX = window.screenX || (event.screenX - event.clientX);
    startWinY = window.screenY || (event.screenY - event.clientY);
    try { handle.setPointerCapture(event.pointerId); } catch (_) {}
    event.preventDefault();
    event.stopPropagation();
  });
});

window.addEventListener('pointermove', event => {
  if (!resizing) return;
  const dx = event.screenX - startX;
  const dy = event.screenY - startY;
  let newW = startW, newH = startH;
  let newX = undefined, newY = undefined;

  if (resizeDir.includes('e')) {
    newW = clamp(startW + dx, MIN_W, MAX_W);
  }
  if (resizeDir.includes('w')) {
    newW = clamp(startW - dx, MIN_W, MAX_W);
    // Когда тянем за левый край, смещаем координату X влево на величину изменения ширины
    if (newW !== startW) {
      newX = startWinX + (startW - newW);
    }
  }
  if (resizeDir.includes('s')) {
    newH = clamp(startH + dy, MIN_H, MAX_H);
  }
  if (resizeDir.includes('n')) {
    newH = clamp(startH - dy, MIN_H, MAX_H);
    if (newH !== startH) {
      newY = startWinY + (startH - newH);
    }
  }

  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    window.playerAPI.resizeBounds({ width: newW, height: newH, x: newX, y: newY });
  });
});

window.addEventListener('pointerup', () => { resizing = false; });
window.addEventListener('pointercancel', () => { resizing = false; });

// Audio loopback & ARGB Background rendering
const audio = { ctx: null, stream: null, source: null, analyser: null, sink: null, data: null, state: 'idle', starting: null, retries: 0, retryTimer: 0, gestureTried: false };
const agc = { init: false, hi: 0, lo: 0 };

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
      audio.analyser.smoothingTimeConstant = 0.65;
      audio.sink = ctx.createGain();
      audio.sink.gain.value = 0;
      audio.source.connect(audio.analyser);
      audio.analyser.connect(audio.sink);
      audio.sink.connect(ctx.destination);
      audio.data = new Uint8Array(audio.analyser.frequencyBinCount);
      track.onended = () => { stopAudio(); };
      audio.state = 'live'; audio.retries = 0;
      return true;
    } catch (e) { stopAudio(); return false; }
    finally { audio.starting = null; }
  })();
  return audio.starting;
}

window.addEventListener('pointerdown', () => {
  if (audio.state !== 'live' && !audio.starting && !audio.gestureTried) {
    audio.gestureTried = true;
    startAudio();
  }
}, { passive: true });

function sampleBass(dt) {
  if (audio.state !== 'live' || !audio.analyser || !state.playing) { agc.init = false; return 0; }
  audio.analyser.getByteFrequencyData(audio.data);
  const hzPerBin = audio.ctx.sampleRate / audio.analyser.fftSize;
  const low = Math.max(1, Math.floor(30 / hzPerBin));
  const high = Math.min(audio.data.length - 1, Math.ceil(160 / hzPerBin));
  let sum = 0, peak = 0, count = 0;
  for (let i = low; i <= high; i++) {
    const v = audio.data[i] / 255;
    sum += v;
    if (v > peak) peak = v;
    count++;
  }
  const raw = count ? (sum / count) * 0.6 + peak * 0.4 : 0;
  if (!agc.init) { agc.hi = raw; agc.lo = raw; agc.init = true; }
  agc.hi = Math.max(raw, agc.hi - dt * 0.05);
  agc.lo = Math.min(raw, agc.lo + dt * 0.035);
  if (raw < 0.04) return 0;
  const n = clamp((raw - agc.lo) / Math.max(0.12, agc.hi - agc.lo), 0, 1);
  return n * n;
}

const aurora = (() => {
  const canvas = $('aurora');
  const ctx = canvas.getContext('2d', { alpha: true });
  const off = document.createElement('canvas');
  const octx = off.getContext('2d');
  const SCALE = 0.48;
  let w = 1, h = 1, raf = 0, last = 0, t = 0, level = 0;
  let smR = 0, smG = 200, smB = 230;

  function resize() {
    const r = canvas.getBoundingClientRect();
    const nw = Math.max(1, Math.round(r.width * SCALE));
    const nh = Math.max(1, Math.round(r.height * SCALE));
    if (canvas.width !== nw) { canvas.width = nw; off.width = nw; }
    if (canvas.height !== nh) { canvas.height = nh; off.height = nh; }
    w = nw; h = nh;
  }

  function rgba(r, g, b, a) {
    return 'rgba(' + (r|0) + ',' + (g|0) + ',' + (b|0) + ',' + a + ')';
  }

  function liquidPath(ox, oy, rx, ry, time, seed) {
    const N = 72;
    octx.beginPath();
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const wave =
        Math.sin(a * 2 + time * 0.55 + seed) * 0.13 +
        Math.sin(a * 3 - time * 0.38 + seed * 1.4) * 0.09 +
        Math.sin(a * 1 + time * 0.28) * 0.07 +
        Math.cos(a * 4 + time * 0.22 + seed) * 0.05;
      const px = ox + Math.cos(a) * rx * (1 + wave);
      const py = oy + Math.sin(a) * ry * (1 + wave * 0.92);
      if (i === 0) octx.moveTo(px, py); else octx.lineTo(px, py);
    }
    octx.closePath();
  }

  function frame(now) {
    raf = 0;
    if (document.hidden) return;
    if (now - last < (state.playing ? 0 : 40)) { raf = requestAnimationFrame(frame); return; }
    const dt = Math.min(0.08, Math.max(0.001, (now - last) / 1000));
    last = now;

    const brightMul = settings.glowBright / 100;
    const isStatic = settings.bgMode === 'static';

    // В ARGB режиме цвета могут плавно переливаться или реагировать на трек
    if (settings.bgMode === 'argb') {
      const hueShift = (t * 15) % 360;
      // Если выбран кастомный цвет, отталкиваемся от него, в аргб-режиме можно добавить циклический сдвиг оттенка
    }

    const target = isStatic ? 0 : sampleBass(dt);
    level += (target - level) * (1 - Math.pow(1 - (target > level ? 0.32 : 0.07), dt * 60));
    t += dt * (isStatic ? 0.04 : (state.playing ? 0.6 : 0.25));

    if (isStatic || settings.bgMode === 'argb') applyBgColor();

    const tr = palette.c0[0], tg = palette.c0[1], tb = palette.c0[2];
    smR += (tr - smR) * 0.045;
    smG += (tg - smG) * 0.045;
    smB += (tb - smB) * 0.045;

    const R = smR * brightMul, G = smG * brightMul, B = smB * brightMul;
    const R1 = R * 0.5, G1 = G * 0.5, B1 = B * 0.5;
    const R2 = R * 0.18, G2 = G * 0.18, B2 = B * 0.18;

    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, w, h);

    const base = Math.min(w, h);
    const breath = 1 + level * 0.14;

    {
      const cx = w * 0.52 + Math.sin(t * 0.09) * w * 0.05;
      const cy = h * 0.40 + Math.cos(t * 0.07) * h * 0.04;
      const rx = base * 0.65 * breath;
      const ry = base * 0.58 * breath;
      liquidPath(cx, cy, rx, ry, t, 0.4);
      const g = octx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry) * 1.2);
      g.addColorStop(0, rgba(R, G, B, 0.58 + level * 0.22));
      g.addColorStop(0.4, rgba(R1, G1, B1, 0.32 + level * 0.12));
      g.addColorStop(0.75, rgba(R2, G2, B2, 0.1));
      g.addColorStop(1, rgba(0, 0, 0, 0));
      octx.fillStyle = g;
      octx.fill();
    }

    {
      const cx = w * 0.38 + Math.cos(t * 0.12) * w * 0.06;
      const cy = h * 0.55 + Math.sin(t * 0.1) * h * 0.05;
      const rx = base * 0.42 * breath;
      const ry = base * 0.38 * breath;
      liquidPath(cx, cy, rx, ry, t * 1.15, 2.2);
      const g = octx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(rx, ry) * 1.15);
      g.addColorStop(0, rgba(R, G, B, 0.42 + level * 0.18));
      g.addColorStop(0.5, rgba(R1, G1, B1, 0.18));
      g.addColorStop(1, rgba(0, 0, 0, 0));
      octx.fillStyle = g;
      octx.fill();
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.filter = 'blur(' + Math.round(base * 0.07) + 'px)';
    ctx.drawImage(off, 0, 0);
    ctx.filter = 'none';

    const vig = ctx.createRadialGradient(w * 0.5, h * 0.42, base * 0.18, w * 0.5, h * 0.42, base * 0.9);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);

    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (!raf && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); }
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
