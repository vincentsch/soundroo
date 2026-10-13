import { makeRng, hashSeed } from './audio/rng.js';

const PALETTES = [
  ['#102e35', '#b6e0c5', '#f1f0d7'], ['#1f1b4d', '#f67553', '#f5cf89'],
  ['#eddccb', '#dc5436', '#272321'], ['#152d69', '#97cbff', '#f6e6b3'],
  ['#35302b', '#ddbb86', '#f1ede1'], ['#2e1d36', '#e57bae', '#ffd5b6'],
  ['#082b28', '#84d5af', '#d7f29a'], ['#412116', '#ea9378', '#eec89c'],
  ['#161826', '#98a6ee', '#e7e0fe'], ['#f0d832', '#253734', '#fff5c5'],
];
const STYLES = ['orbit', 'strata', 'window', 'wave', 'sun', 'petal', 'ripple', 'monolith', 'weave', 'constellation'];
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const color = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value ?? '') ? value : fallback;

// Original geometric record sleeves. No external assets, fonts or requests.
export function coverSvg(track = {}) {
  const seed = hashSeed(track.id ?? track.title ?? 'soundroo', track.artwork?.seed ?? 1);
  const rng = makeRng(seed);
  const palette = PALETTES[seed % PALETTES.length];
  const requested = track.artwork?.colors ?? track.artwork?.palette;
  const colors = Array.isArray(requested) ? requested.map((v, i) => color(v, palette[i % 3])) : palette;
  const [bg, ink, light] = [colors[0] ?? palette[0], colors[1] ?? palette[1], colors[2] ?? palette[2]];
  const style = STYLES.includes(track.artwork?.style) ? track.artwork.style : STYLES[seed % STYLES.length];
  const shape = [];
  const add = value => shape.push(value);
  if (style === 'orbit') {
    add(`<circle cx="350" cy="360" r="240" fill="${ink}"/>`);
    for (let i = 0; i < 12; i++) add(`<ellipse cx="400" cy="400" rx="${160 + i * 17}" ry="${50 + i * 14}" fill="none" stroke="${light}" stroke-width="2" transform="rotate(-38 400 400)" opacity="${0.18 + i * 0.05}"/>`);
    add(`<circle cx="571" cy="242" r="34" fill="${light}"/>`);
  } else if (style === 'strata') {
    for (let i = 0; i < 19; i++) {
      const y = 80 + i * 34;
      add(`<path d="M-70 ${y} Q180 ${y - 150 * Math.sin(i / 5)} 410 ${y + 60} T870 ${y - 30}" stroke="${i % 4 === 0 ? light : ink}" stroke-width="${10 + i % 3 * 3}" fill="none"/>`);
    }
  } else if (style === 'window') {
    add(`<rect x="170" y="110" width="460" height="590" rx="230" fill="${ink}"/>`);
    add(`<circle cx="450" cy="280" r="140" fill="${light}"/>`);
    for (let i = 0; i < 12; i++) add(`<path d="M170 ${400 + i * 26} Q400 ${330 + i * 31} 630 ${420 + i * 22}" stroke="${bg}" stroke-width="9" fill="none"/>`);
  } else if (style === 'wave') {
    for (let i = 0; i < 38; i++) {
      const points = Array.from({ length: 33 }, (_, j) => {
        const x = j * 25;
        const y = 135 + i * 14 + Math.sin(j / 4 + i / 8) * 68 + Math.sin(j / 9) * 95;
        return `${x},${y.toFixed(1)}`;
      }).join(' ');
      add(`<polyline points="${points}" stroke="${i % 9 === 0 ? light : ink}" stroke-width="3" fill="none"/>`);
    }
  } else if (style === 'sun') {
    add(`<circle cx="400" cy="340" r="215" fill="${ink}"/>`);
    for (let i = 0; i < 13; i++) add(`<rect x="145" y="${325 + i * 24}" width="510" height="${3 + i * 0.8}" fill="${bg}"/>`);
    add(`<path d="M0 580 Q200 480 400 590 T800 610 V800 H0Z" fill="${light}" opacity=".8"/>`);
    add(`<path d="M0 660 Q300 580 800 680 V800 H0Z" fill="${ink}"/>`);
  } else if (style === 'petal') {
    for (let i = 0; i < 16; i++) add(`<ellipse cx="400" cy="260" rx="62" ry="180" fill="${i % 2 ? ink : light}" opacity=".76" transform="rotate(${i * 22.5} 400 400)"/>`);
    add(`<circle cx="400" cy="400" r="42" fill="${bg}"/>`);
  } else if (style === 'ripple') {
    for (let i = 0; i < 24; i++) add(`<ellipse cx="400" cy="400" rx="${20 + i * 14}" ry="${12 + i * 12}" transform="rotate(-24 400 400)" stroke="${i % 5 ? ink : light}" stroke-width="${i % 3 + 2}" fill="none"/>`);
    add(`<circle cx="400" cy="400" r="17" fill="${light}"/>`);
  } else if (style === 'monolith') {
    add(`<path d="M200 650 L370 110 L610 140 L520 690Z" fill="${ink}"/>`);
    add(`<path d="M370 110 L400 260 L260 710 L200 650Z" fill="${light}"/>`);
    for (let i = 0; i < 15; i++) add(`<path d="M${405 + i * 11} ${205 + i * 16} L${325 + i * 10} 660" stroke="${bg}" stroke-width="2" opacity=".6"/>`);
  } else if (style === 'weave') {
    for (let i = 0; i < 16; i++) {
      const x = 110 + i * 38;
      add(`<path d="M${x} 100 Q${x + 100} 300 ${x} 400 T${x} 700" stroke="${i % 4 ? ink : light}" stroke-width="17" fill="none"/>`);
      add(`<path d="M100 ${x} Q300 ${x - 70} 400 ${x} T700 ${x}" stroke="${i % 4 ? light : ink}" stroke-width="5" fill="none" opacity=".6"/>`);
    }
  } else {
    for (let i = 0; i < 50; i++) {
      const x = 95 + rng.next() * 610, y = 95 + rng.next() * 610;
      add(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(2 + rng.next() * 9).toFixed(1)}" fill="${i % 3 ? ink : light}"/>`);
      if (i % 6 === 0) add(`<path d="M${x.toFixed(1)} ${y.toFixed(1)} L400 400" stroke="${ink}" stroke-width=".8" opacity=".4"/>`);
    }
    add(`<circle cx="400" cy="400" r="92" stroke="${light}" stroke-width="1.5" fill="none"/>`);
  }
  const title = escape(track.title ?? 'Soundroo');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 800" role="img" aria-label="${title} cover"><title>${title}</title><defs><filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter></defs><rect width="800" height="800" fill="${bg}"/>${shape.join('')}<rect width="800" height="800" filter="url(#grain)" opacity=".075"/><text x="42" y="58" fill="${light}" font-family="Arial,sans-serif" font-size="15" letter-spacing="4">SOUNDROO</text><text x="42" y="758" fill="${light}" font-family="Arial,sans-serif" font-size="22" letter-spacing="1">${title.slice(0, 80)}</text><text x="756" y="58" text-anchor="end" fill="${light}" font-family="Arial,sans-serif" font-size="13">${String(seed % 100).padStart(2, '0')}</text></svg>`;
}
