// Small DOM helpers. Strings always become text nodes, so titles, notes and
// briefs written by people or agents are never parsed as HTML.
import { hashHue } from './logic.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PROPERTIES = new Set(['value', 'checked', 'selected', 'indeterminate']);

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function h(tag, props = null, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (key.startsWith('aria-') && typeof value === 'boolean') el.setAttribute(key, String(value));
      else if (value == null || value === false) continue;
      else if (key === 'class') el.className = value;
      else if (key === 'dataset') Object.assign(el.dataset, value);
      else if (key === 'style') for (const [prop, v] of Object.entries(value)) el.style.setProperty(prop, v);
      else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
      else if (PROPERTIES.has(key)) el[key] = value;
      else el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const child of children) {
    if (child == null || child === false || child === true) continue;
    if (Array.isArray(child)) appendChildren(el, child);
    else el.append(child instanceof Node ? child : String(child));
  }
}

// For append()/replaceChildren(), which would turn null into the text "null".
export const nodes = (...items) => items.flat(Infinity).filter(item => item != null && item !== false && item !== true);

export function icon(name, className = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `icon ${className}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

export function iconButton(name, label, props = {}) {
  return h('button', { type: 'button', class: 'icon-btn', 'aria-label': label, title: label, ...props }, icon(name));
}

// Record sleeve with a quiet generated fallback when no artwork is available.
export function artwork(track, { className = '', eager = false, tag = 'div' } = {}) {
  const hue = hashHue(track?.title ?? track?.id ?? '');
  const box = h(tag, {
    class: `art ${className}`.trim(),
    style: { '--art-hue': String(hue) },
    dataset: { initial: (track?.title ?? '♪').trim().charAt(0).toUpperCase() || '♪' },
  });
  if (track?.artworkUrl) {
    const img = h('img', { src: track.artworkUrl, alt: '', loading: eager ? 'eager' : 'lazy', decoding: 'async', draggable: 'false' });
    img.addEventListener('error', () => {
      img.remove();
      box.classList.add('art-missing');
    }, { once: true });
    box.append(img);
  } else {
    box.classList.add('art-missing');
  }
  return box;
}

let liveTimer = 0;
export function announce(message) {
  const live = document.getElementById('live');
  if (!live) return;
  clearTimeout(liveTimer);
  live.textContent = '';
  liveTimer = setTimeout(() => { live.textContent = message; }, 60);
}

export function toast(message, { tone = 'info', action = null, timeout } = {}) {
  const region = document.getElementById('toasts');
  if (!region) return;
  for (const existing of [...region.children]) if (existing.dataset.message === message) existing.remove();
  while (region.children.length >= 3) region.firstElementChild.remove();
  const duration = timeout ?? (action ? 9000 : tone === 'error' ? 8000 : 4500);
  let timer = 0;
  const el = h('div', { class: `toast toast-${tone}`, dataset: { message } }, h('p', { class: 'toast-text' }, message));
  const close = () => {
    clearTimeout(timer);
    el.classList.add('toast-leaving');
    setTimeout(() => el.remove(), 180);
  };
  if (action) {
    el.append(h('button', {
      type: 'button',
      class: 'toast-action',
      onclick: () => { close(); action.run(); },
    }, action.label));
  }
  el.append(h('button', { type: 'button', class: 'toast-close', 'aria-label': 'Dismiss', onclick: close }, icon('close')));
  const arm = () => { clearTimeout(timer); timer = setTimeout(close, duration); };
  el.addEventListener('pointerenter', () => clearTimeout(timer));
  el.addEventListener('pointerleave', arm);
  el.addEventListener('focusin', () => clearTimeout(timer));
  el.addEventListener('focusout', arm);
  region.append(el);
  arm();
}

export function errorMessage(error, fallback = 'Something went wrong.') {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  return error.message || fallback;
}

export async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const area = h('textarea', { class: 'visually-hidden', readonly: true, 'aria-hidden': 'true' });
    area.value = value;
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

export const reducedMotion = () => document.documentElement.dataset.motion === 'reduce';

// Re-render while keeping keyboard focus on the equivalent control.
export function preserveFocus(render) {
  const key = document.activeElement?.closest?.('[data-key]')?.dataset.key;
  render();
  if (!key) return;
  const target = document.querySelector(`[data-key="${CSS.escape(key)}"]`);
  if (target && target !== document.activeElement) target.focus({ preventScroll: true });
}
