// Full-screen listening: sleeve, sections and a visualizer driven by the real
// audio through the player's analyser. Animates only while open, playing,
// visible and allowed by the motion setting.
import { api } from './api.js';
import { settings, updateSettings, on } from './store.js';
import { $, h, icon, reducedMotion } from './dom.js';
import { formatTime, sectionIndexAt, paletteFromPixels, normalizeFeedback, resampleMax, clamp } from './logic.js';
import { registerAction } from './transport.js';
import * as player from './player.js';

const dialog = $('#np');
const canvas = $('#np-viz');
const backdrop = $('[data-np-bg]');
const sectionsEl = $('#np-sections');
const descEl = $('#np-desc');
const markersEl = $('#np-markers');
const styleButton = $('#np-viz-style');
const STYLES = { rings: 'Rings', bars: 'Bars', wave: 'Wave' };
const FALLBACK = { background: 'rgb(32 30 28)', accent: 'rgb(255 122 82)', accent2: 'rgb(242 200 120)', dark: true };

let raf = 0;
let shownTrackId = null;
let activeSection = -2;
let freq = null;
let wave = null;
let notes = [];
let notesTicket = 0;
const palettes = new Map();
let palette = FALLBACK;

export const isOpen = () => dialog.open;

export function openNowPlaying() {
  if (dialog.open) return;
  dialog.showModal();
  document.documentElement.classList.add('np-open');
  refresh(true);
  resize();
  loop();
}

export function closeNowPlaying() {
  if (dialog.open) dialog.close();
}

registerAction('fullscreen', () => (dialog.open ? closeNowPlaying() : openNowPlaying()));

dialog.addEventListener('close', () => {
  document.documentElement.classList.remove('np-open');
  stop();
});
dialog.addEventListener('click', event => {
  if (event.target.closest('[data-np-close]')) closeNowPlaying();
});

styleButton.addEventListener('click', () => {
  const keys = Object.keys(STYLES);
  updateSettings({ visualizer: keys[(keys.indexOf(settings.visualizer) + 1) % keys.length] });
});

function syncStyleButton() {
  styleButton.textContent = STYLES[settings.visualizer] ?? 'Rings';
  styleButton.setAttribute('aria-label', `Visualizer: ${STYLES[settings.visualizer] ?? 'Rings'}. Change style`);
}

// --- content ------------------------------------------------------------------

function refresh(force = false) {
  const track = player.currentTrack();
  if (!force && track?.id === shownTrackId) return;
  shownTrackId = track?.id ?? null;
  activeSection = -2;
  descEl.textContent = track?.description ?? '';
  sectionsEl.replaceChildren(...(track?.sections ?? []).map((section, i) => h('li', {},
    h('button', {
      type: 'button',
      class: 'np-section',
      dataset: { index: String(i) },
      onclick: () => {
        player.seek(section.start);
        if (!player.state.playing) player.play();
      },
    }, h('span', { class: 'np-section-name' }, section.name), h('span', { class: 'np-section-time' }, formatTime(section.start))))));
  dialog.classList.toggle('has-sections', Boolean(track?.sections.length));
  backdrop.replaceChildren(track?.artworkUrl ? h('img', { src: track.artworkUrl, alt: '', decoding: 'async' }) : '');
  notes = [];
  renderMarkers();
  if (track) {
    loadPalette(track);
    loadNotes(track.id);
  }
  updateSection();
}

async function loadPalette(track) {
  const url = track.artworkUrl;
  if (!url) return applyPalette(FALLBACK);
  if (!palettes.has(url)) palettes.set(url, samplePalette(url));
  const result = await palettes.get(url);
  if (player.currentTrack()?.artworkUrl === url) applyPalette(result);
}

function samplePalette(url) {
  return new Promise(resolve => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      try {
        const size = 48;
        const sample = document.createElement('canvas');
        sample.width = size;
        sample.height = size;
        const ctx = sample.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, size, size);
        resolve(paletteFromPixels(ctx.getImageData(0, 0, size, size).data) ?? FALLBACK);
      } catch {
        resolve(FALLBACK);
      }
    };
    img.onerror = () => resolve(FALLBACK);
    img.src = url;
  });
}

function applyPalette(next) {
  palette = next;
  dialog.style.setProperty('--np-bg', next.background);
  dialog.style.setProperty('--np-accent', next.accent);
  dialog.style.setProperty('--np-accent-2', next.accent2);
  if (!raf) drawStatic();
}

async function loadNotes(trackId) {
  const mine = ++notesTicket;
  try {
    const result = await api.track(trackId);
    if (mine !== notesTicket || shownTrackId !== trackId) return;
    notes = normalizeFeedback((result?.track ? { ...result.track, ...result } : result)?.feedback);
  } catch {
    notes = []; // markers are a nicety; listening continues without them
  }
  renderMarkers();
}

function renderMarkers() {
  const total = player.duration();
  markersEl.replaceChildren(...(total > 0 ? notes : []).map(note => h('button', {
    type: 'button',
    class: 'np-marker',
    style: { left: `${clamp(note.time / total, 0, 1) * 100}%` },
    title: `${formatTime(note.time)} · ${note.text.slice(0, 120)}`,
    'aria-label': `Note at ${formatTime(note.time)}: ${note.text.slice(0, 80)}`,
    onclick: () => player.seek(note.time),
  }, icon('note'))));
}

function updateSection() {
  const track = player.currentTrack();
  const index = track ? sectionIndexAt(track.sections, player.currentTime()) : -1;
  if (index === activeSection) return;
  activeSection = index;
  for (const button of sectionsEl.querySelectorAll('.np-section')) {
    const active = Number(button.dataset.index) === index;
    button.classList.toggle('is-active', active);
    if (active) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
    if (active && dialog.open) button.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }
}

// --- visualizer ---------------------------------------------------------------

let width = 0;
let height = 0;
let scale = 1;

function resize() {
  const rect = dialog.getBoundingClientRect();
  // Cap the backing store on very large screens to keep the frame cheap.
  scale = Math.min(2, window.devicePixelRatio || 1, Math.sqrt(2_600_000 / Math.max(1, rect.width * rect.height)));
  width = Math.max(1, Math.round(rect.width * scale));
  height = Math.max(1, Math.round(rect.height * scale));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  if (!raf) drawStatic();
}

const observer = new ResizeObserver(() => { if (dialog.open) resize(); });
observer.observe(dialog);

function canAnimate() {
  return dialog.open && player.state.playing && !document.hidden && !reducedMotion() && Boolean(player.analyser());
}

function loop() {
  if (raf) return;
  if (!canAnimate()) {
    drawStatic();
    return;
  }
  raf = requestAnimationFrame(frame);
}

function stop() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

function frame() {
  raf = 0;
  if (!canAnimate()) {
    drawStatic();
    return;
  }
  const node = player.analyser();
  if (!freq || freq.length !== node.frequencyBinCount) {
    freq = new Uint8Array(node.frequencyBinCount);
    wave = new Uint8Array(node.fftSize);
  }
  node.getByteFrequencyData(freq);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  if (settings.visualizer === 'bars') drawBars(ctx, node);
  else if (settings.visualizer === 'wave') drawWave(ctx, node);
  else drawRings(ctx, node);
  raf = requestAnimationFrame(frame);
}

// Average energy of log-spaced bands between 30 Hz and 16 kHz.
function bands(node, count) {
  const binHz = node.context.sampleRate / 2 / freq.length;
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    const from = Math.floor((30 * (16000 / 30) ** (i / count)) / binHz);
    const to = Math.max(from + 1, Math.ceil((30 * (16000 / 30) ** ((i + 1) / count)) / binHz));
    let sum = 0;
    for (let j = from; j < to && j < freq.length; j++) sum += freq[j];
    out[i] = sum / (to - from) / 255;
  }
  return out;
}

function artCircle() {
  const art = dialog.querySelector('.np-art');
  const rect = art?.getBoundingClientRect();
  const frame = dialog.getBoundingClientRect();
  if (!rect || !rect.width) return { x: width / 2, y: height * 0.42, r: Math.min(width, height) * 0.22 };
  return {
    x: (rect.left - frame.left + rect.width / 2) * scale,
    y: (rect.top - frame.top + rect.height / 2) * scale,
    r: (rect.width / 2) * scale,
  };
}

function drawRings(ctx, node) {
  const [low, mid, high] = bands(node, 3);
  const { x, y, r } = artCircle();
  const glow = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * (2 + low));
  glow.addColorStop(0, withAlpha(palette.accent, 0.32 * low + 0.06));
  glow.addColorStop(1, withAlpha(palette.accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  for (let k = 0; k < 7; k++) {
    const radius = r * (1.08 + k * 0.17) + low ** 1.5 * r * 0.35 * (1 - k / 8);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = withAlpha(k % 2 ? palette.accent2 : palette.accent, clamp((0.55 - k * 0.07) * (0.35 + mid * 1.2), 0.03, 0.8));
    ctx.lineWidth = (1.5 + high * 7 * (1 - k / 7)) * scale;
    ctx.stroke();
  }
}

function drawBars(ctx, node) {
  const count = Math.round(clamp(width / (16 * scale), 24, 96));
  const values = bands(node, count);
  const slot = width / count;
  const barWidth = slot * 0.58;
  const maxHeight = height * 0.38;
  const gradient = ctx.createLinearGradient(0, height, 0, height - maxHeight);
  gradient.addColorStop(0, withAlpha(palette.accent, 0.75));
  gradient.addColorStop(1, withAlpha(palette.accent2, 0.15));
  ctx.fillStyle = gradient;
  for (let i = 0; i < count; i++) {
    const barHeight = Math.max(2 * scale, values[i] ** 1.35 * maxHeight);
    const x = i * slot + (slot - barWidth) / 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, height - barHeight, barWidth, barHeight + barWidth, barWidth / 2);
    else ctx.rect(x, height - barHeight, barWidth, barHeight);
    ctx.fill();
  }
}

function drawWave(ctx, node) {
  node.getByteTimeDomainData(wave);
  const [low] = bands(node, 3);
  const mid = height * 0.74;
  const amplitude = height * 0.16;
  const points = 256;
  const stride = Math.max(1, Math.floor(wave.length / points));
  for (const [color, alpha, line, lift] of [[palette.accent2, 0.35, 7, 1.4], [palette.accent, 0.95, 2.4, 1]]) {
    ctx.beginPath();
    for (let i = 0; i < points; i++) {
      const value = (wave[i * stride] - 128) / 128;
      const px = (i / (points - 1)) * width;
      const py = mid + value * amplitude * lift * (0.7 + low);
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.strokeStyle = withAlpha(color, alpha);
    ctx.lineWidth = line * scale;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

// Paused, hidden or reduced motion: the track's own waveform with progress.
function drawStatic() {
  if (!dialog.open) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  const track = player.currentTrack();
  if (!track?.waveform.length) return;
  const total = player.duration();
  const progress = total > 0 ? player.currentTime() / total : 0;
  const step = 5 * scale;
  const count = Math.max(1, Math.floor(width / step));
  const values = resampleMax(track.waveform, count);
  const base = height - 1;
  const maxHeight = height * 0.16;
  for (let i = 0; i < count; i++) {
    const barHeight = Math.max(scale, values[i] ** 0.8 * maxHeight);
    ctx.fillStyle = withAlpha(i / count <= progress ? palette.accent : palette.accent2, i / count <= progress ? 0.55 : 0.18);
    ctx.fillRect(i * step, base - barHeight, 3 * scale, barHeight);
  }
}

function withAlpha(color, alpha) {
  const match = /rgb\((\d+) (\d+) (\d+)\)/.exec(color);
  return match ? `rgb(${match[1]} ${match[2]} ${match[3]} / ${clamp(alpha, 0, 1).toFixed(3)})` : color;
}

// --- events ---------------------------------------------------------------------

on('player', () => {
  if (!dialog.open) return;
  refresh();
  updateSection();
  if (player.state.playing) loop();
  else {
    stop();
    drawStatic();
  }
});
on('time', () => {
  if (!dialog.open) return;
  updateSection();
  // The analyser becomes available once the audio context is running.
  if (!raf) loop();
});
on('settings', () => {
  syncStyleButton();
  if (!dialog.open) return;
  stop();
  loop();
});
on('feedback', id => {
  if (dialog.open && id === shownTrackId) loadNotes(id);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stop();
  else if (dialog.open) loop();
});

syncStyleButton();
