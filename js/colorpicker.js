// colorpicker.js — color picker tool (self-contained)
import { showStatus } from './core.js';

const cpEl = document.getElementById('color-picker');
const cpSv = document.getElementById('cp-sv');
const cpHue = document.getElementById('cp-hue');
const cpPreview = document.getElementById('cp-preview');
const cpHex = document.getElementById('cp-hex');
const cpSvCtx = cpSv.getContext('2d');
const cpHueCtx = cpHue.getContext('2d');
let cpH = 0, cpS = 1, cpV = 1;

function hsvToRgb(h, s, v) {
  let r, g, b;
  const i = Math.floor(h / 60) % 6;
  const f = h / 60 - Math.floor(h / 60);
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  switch (i) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

function drawHueBar() {
  const w = cpHue.width, h = cpHue.height;
  for (let x = 0; x < w; x++) {
    const [r, g, b] = hsvToRgb((x / w) * 360, 1, 1);
    cpHueCtx.fillStyle = rgbToHex(r, g, b);
    cpHueCtx.fillRect(x, 0, 1, h);
  }
}

function drawSvSquare() {
  const w = cpSv.width, h = cpSv.height;
  const img = cpSvCtx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = x / w, v = 1 - y / h;
      const [r, g, b] = hsvToRgb(cpH, s, v);
      const i = (y * w + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  cpSvCtx.putImageData(img, 0, 0);
}

function updateCpDisplay() {
  const [r, g, b] = hsvToRgb(cpH, cpS, cpV);
  const hex = rgbToHex(r, g, b);
  cpPreview.style.background = hex;
  cpHex.value = hex;
}

function openColorPicker() {
  drawHueBar();
  drawSvSquare();
  updateCpDisplay();
  cpEl.style.display = 'block';
}

// Listen for custom event from commands.js
document.addEventListener('open-color-picker', openColorPicker);

document.getElementById('cp-close').addEventListener('click', () => { cpEl.style.display = 'none'; });
document.getElementById('cp-copy').addEventListener('click', () => {
  navigator.clipboard.writeText(cpHex.value).then(() => showStatus('Copied: ' + cpHex.value));
});

cpHex.addEventListener('input', () => {
  const hex = cpHex.value.trim();
  const m = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return;
  const r = parseInt(m[1].slice(0, 2), 16) / 255;
  const g = parseInt(m[1].slice(2, 4), 16) / 255;
  const b = parseInt(m[1].slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  cpV = max;
  cpS = max === 0 ? 0 : d / max;
  if (d === 0) cpH = 0;
  else if (max === r) cpH = 60 * (((g - b) / d) % 6);
  else if (max === g) cpH = 60 * ((b - r) / d + 2);
  else cpH = 60 * ((r - g) / d + 4);
  if (cpH < 0) cpH += 360;
  drawSvSquare();
  cpPreview.style.background = '#' + m[1];
});

let cpSvDown = false, cpHueDown = false;
function handleSv(e) {
  const rect = cpSv.getBoundingClientRect();
  cpS = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  cpV = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
  updateCpDisplay();
}
function handleHue(e) {
  const rect = cpHue.getBoundingClientRect();
  cpH = Math.max(0, Math.min(360, (e.clientX - rect.left) / rect.width * 360));
  drawSvSquare();
  updateCpDisplay();
}
cpSv.addEventListener('mousedown', e => { cpSvDown = true; handleSv(e); });
cpHue.addEventListener('mousedown', e => { cpHueDown = true; handleHue(e); });
document.addEventListener('mousemove', e => {
  if (cpSvDown) handleSv(e);
  if (cpHueDown) handleHue(e);
});
document.addEventListener('mouseup', () => { cpSvDown = false; cpHueDown = false; });

// Escape to close
document.addEventListener('keydown', e => {
  if (cpEl.style.display === 'block' && e.key === 'Escape') {
    cpEl.style.display = 'none';
  }
});
