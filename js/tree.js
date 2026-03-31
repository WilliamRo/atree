// tree.js — directory scanning, layout, drawing, camera, canvas interactions
import {
  state, canvas, canvasCtx, tooltip, promptEl, ccmdPanel, ccmdTitle, ccmdBody,
  ctxMenu, ccmdDrag, nsKey, setActiveRoot, SKIP,
  saveHandle, getTopChildren, saveHistory, loadHistory, loadHandle,
  readMdFile, listMdFiles, showStatus, resize,
} from './core.js';

// These will be set by mdv.js to break circular dependency
let _renderMarkdown = null;
let _jumpPush = null;
let _saveMdv = null;
let _updateToolbar = null;
let _reloadCcmd = null;
let _renderHistory = null;
let _restoreRootState = null;

export function setMdvCallbacks(callbacks) {
  _renderMarkdown = callbacks.renderMarkdown;
  _jumpPush = callbacks.jumpPush;
  _saveMdv = callbacks.saveMdv;
  _updateToolbar = callbacks.updateToolbar;
  _reloadCcmd = callbacks.reloadCcmd;
  _renderHistory = callbacks.renderHistory;
  _restoreRootState = callbacks.restoreRootState;
}

// --- Directory scanning ---

async function scanDir(handle, maxDepth = 7, depth = 0) {
  const node = { name: handle.name };
  if (depth >= maxDepth) return node;

  const children = [];
  let hasCcmd = false;

  for await (const entry of handle.values()) {
    if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
    if (entry.kind === 'directory') {
      children.push(await scanDir(entry, maxDepth, depth + 1));
    } else if (entry.name === 'CLAUDE.md') {
      hasCcmd = true;
    }
  }
  if (children.length > 0) {
    children.sort((a, b) => a.name.localeCompare(b.name));
    node.children = children;
  }
  if (hasCcmd) node.hasCcmd = true;
  return node;
}

export async function pickAndScan() {
  try {
    state.dirHandle = await window.showDirectoryPicker();
    setActiveRoot(state.dirHandle.name);
    await saveHandle(state.dirHandle);
    const ctx = await getTopChildren(state.dirHandle);
    await saveHistory(state.dirHandle, ctx);
    await scanAndRender();
  } catch (e) {
    if (e.name !== 'AbortError') console.error(e);
  }
}

export async function scanAndRender() {
  if (!state.dirHandle) return;
  showStatus('Scanning...');
  try {
    const isFirstScan = !state.treeData;
    state.treeData = await scanDir(state.dirHandle);
    localStorage.setItem(nsKey('hub-tree-data'), JSON.stringify(state.treeData));
    promptEl.style.display = 'none';
    if (isFirstScan) { state.camX = 0; state.camY = 0; state.zoom = 1; }
    layout(true);
    draw();
    showStatus('Tree updated');
  } catch (e) {
    showStatus('Permission denied — press r to retry');
    state.dirHandle = null;
  }
}

export async function rescan() {
  if (state.dirHandle) {
    try {
      const perm = await state.dirHandle.queryPermission({ mode: 'read' });
      if (perm === 'granted') { await scanAndRender(); return; }
      const req = await state.dirHandle.requestPermission({ mode: 'read' });
      if (req === 'granted') { await scanAndRender(); return; }
    } catch (e) {}
  }
  await pickAndScan();
}

// --- Find ccmd for a node path ---
export function findHasCcmd(path) {
  const parts = path.split('/');
  let cur = state.treeData;
  if (!cur) return false;
  if (parts.length === 1) return !!cur.hasCcmd;
  for (let i = 1; i < parts.length; i++) {
    if (!cur.children) return false;
    cur = cur.children.find(c => c.name === parts[i]);
    if (!cur) return false;
  }
  return !!cur.hasCcmd;
}

// --- Layout & drawing ---

function countLeaves(node, pathPrefix) {
  const p = pathPrefix ? pathPrefix + '/' + node.name : node.name;
  if (!node.children || node.children.length === 0) return 1;
  if (state.collapsed.has(p)) return 1;
  return node.children.reduce((s, c) => s + countLeaves(c, p), 0);
}

export function layout(applyPinned) {
  if (applyPinned) state.pinnedCollapsed.forEach(p => state.collapsed.add(p));

  state.nodes.length = 0;
  if (!state.treeData) return;
  state.nodes.push({ x: 0, y: 0, r: 10, name: state.treeData.name, path: state.treeData.name, depth: 0, isLeaf: false, parent: null });

  function assignPositions(node, depth, angleStart, angleEnd, parentIdx, pathPrefix) {
    if (!node.children || node.children.length === 0) return;
    if (state.collapsed.has(pathPrefix)) return;
    const radius = depth * state.layerSpacing;
    const totalChildLeaves = node.children.reduce((s, c) => s + countLeaves(c, pathPrefix), 0);
    let currentAngle = angleStart;

    node.children.forEach(child => {
      const childLeaves = countLeaves(child, pathPrefix);
      const childAngleSpan = (childLeaves / totalChildLeaves) * (angleEnd - angleStart);
      const midAngle = currentAngle + childAngleSpan / 2;
      const isLeaf = !child.children || child.children.length === 0;
      const x = Math.cos(midAngle) * radius;
      const y = Math.sin(midAngle) * radius;
      const childPath = pathPrefix + '/' + child.name;

      const idx = state.nodes.length;
      state.nodes.push({
        x, y,
        r: isLeaf ? 5 : 7,
        name: child.name,
        path: childPath,
        depth,
        isLeaf,
        parent: parentIdx
      });

      assignPositions(child, depth + 1, currentAngle, currentAngle + childAngleSpan, idx, childPath);
      currentAngle += childAngleSpan;
    });
  }

  assignPositions(state.treeData, 1, 0, Math.PI * 2, 0, state.treeData.name);

  // Build full node list for search (ignores collapse)
  state.allNodes.length = 0;
  function buildAll(node, pathPrefix) {
    const p = pathPrefix ? pathPrefix + '/' + node.name : node.name;
    const isLeaf = !node.children || node.children.length === 0;
    state.allNodes.push({ name: node.name, path: p, isLeaf });
    if (node.children) node.children.forEach(c => buildAll(c, p));
  }
  buildAll(state.treeData, '');
}

function isVisible(idx) {
  let cur = state.nodes[idx].parent;
  while (cur !== null) {
    if (state.collapsed.has(state.nodes[cur].path)) return false;
    cur = state.nodes[cur].parent;
  }
  return true;
}

export function toScreen(wx, wy) {
  return {
    x: (wx + state.camX) * state.zoom + state.W / 2,
    y: (wy + state.camY) * state.zoom + state.H / 2
  };
}

export function toWorld(sx, sy) {
  return {
    x: (sx - state.W / 2) / state.zoom - state.camX,
    y: (sy - state.H / 2) / state.zoom - state.camY
  };
}

export function draw() {
  const ctx = canvasCtx;
  ctx.clearRect(0, 0, state.W, state.H);
  if (!state.treeData || state.nodes.length === 0) return;

  // Branches
  state.nodes.forEach((node, i) => {
    if (node.parent === null) return;
    if (!isVisible(i)) return;
    const parent = state.nodes[node.parent];
    const p1 = toScreen(parent.x, parent.y);
    const p2 = toScreen(node.x, node.y);

    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    const mx = (p1.x + p2.x) / 2;
    const my = (p1.y + p2.y) / 2;
    ctx.quadraticCurveTo(mx + (p2.y - p1.y) * 0.1, my - (p2.x - p1.x) * 0.1, p2.x, p2.y);

    const d = Math.min(node.depth, 5);
    const thickness = Math.max(0.8, (5 - d) * 0.8 * state.zoom);
    ctx.lineWidth = thickness;
    const alpha = 0.3 + 0.15 * (5 - d);
    ctx.strokeStyle = `rgba(101, 78, 50, ${alpha})`;
    ctx.stroke();
  });

  // Nodes
  state.nodes.forEach((node, i) => {
    if (!isVisible(i)) return;
    const s = toScreen(node.x, node.y);
    const sr = node.r * state.zoom;

    if (s.x < -50 || s.x > state.W + 50 || s.y < -50 || s.y > state.H + 50) return;

    // Check if this node has a ccmd
    const hasCcmd = findHasCcmd(node.path);
    const isFocused = state.focusedPath === node.path;

    // Focus glow (behind node)
    if (isFocused) {
      const glowR = sr * 4;
      const glow = ctx.createRadialGradient(s.x, s.y, sr * 0.5, s.x, s.y, glowR);
      glow.addColorStop(0, 'rgba(227, 179, 65, 0.45)');
      glow.addColorStop(1, 'rgba(227, 179, 65, 0)');
      ctx.beginPath();
      ctx.arc(s.x, s.y, glowR, 0, Math.PI * 2);
      ctx.fillStyle = glow;
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(s.x, s.y, sr, 0, Math.PI * 2);

    if (node.depth === 0) {
      ctx.fillStyle = '#f0883e';
      ctx.fill();
      ctx.strokeStyle = '#ffa657';
      ctx.lineWidth = 2 * state.zoom;
      ctx.stroke();
    } else if (node.isLeaf) {
      const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, sr * 2.5);
      grad.addColorStop(0, 'rgba(126, 231, 135, 0.9)');
      grad.addColorStop(0.5, 'rgba(126, 231, 135, 0.3)');
      grad.addColorStop(1, 'rgba(126, 231, 135, 0)');
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s.x, s.y, sr * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = '#7ee787';
      ctx.fill();
    } else {
      const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, sr * 2.5);
      grad.addColorStop(0, 'rgba(88, 166, 255, 0.8)');
      grad.addColorStop(0.5, 'rgba(88, 166, 255, 0.2)');
      grad.addColorStop(1, 'rgba(88, 166, 255, 0)');
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(s.x, s.y, sr * 0.7, 0, Math.PI * 2);
      ctx.fillStyle = '#58a6ff';
      ctx.fill();
    }

    // Ccmd indicator — small orange dot
    if (hasCcmd && sr > 3) {
      ctx.beginPath();
      ctx.arc(s.x + sr * 0.7, s.y - sr * 0.7, Math.max(2, sr * 0.25), 0, Math.PI * 2);
      ctx.fillStyle = '#f0883e';
      ctx.fill();
    }

    // Focus ring (on top of node)
    if (isFocused) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, sr + Math.max(3, 4 * state.zoom), 0, Math.PI * 2);
      ctx.strokeStyle = '#e3b341';
      ctx.lineWidth = Math.max(1.5, 2 * state.zoom);
      ctx.stroke();
    }

    // Collapsed indicator
    if (state.collapsed.has(node.path)) {
      ctx.save();
      ctx.font = `bold ${Math.max(8, 10 * state.zoom)}px "Cascadia Code", monospace`;
      ctx.fillStyle = node.depth === 0 ? '#b35f1a' : node.isLeaf ? '#3d8b45' : '#2a6cbf';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('+', s.x, s.y);
      ctx.restore();
    }

    // Viewing indicator — yellow arrow pointing to node
    if (state.selectedNodePath === node.path && ccmdPanel.style.display === 'flex') {
      ctx.save();
      const arrOff = sr + Math.max(6, 8 * state.zoom);
      const arrLen = Math.max(12, 16 * state.zoom);
      const headLen = Math.max(5, 6 * state.zoom);
      const headHW = Math.max(3, 3.5 * state.zoom);
      const lw = Math.max(1.2, 1.5 * state.zoom);
      // Shaft
      ctx.beginPath();
      ctx.moveTo(s.x - arrOff - arrLen, s.y);
      ctx.lineTo(s.x - arrOff - headLen, s.y);
      ctx.strokeStyle = '#e3b341';
      ctx.lineWidth = lw;
      ctx.stroke();
      // Arrowhead
      ctx.beginPath();
      ctx.moveTo(s.x - arrOff, s.y);
      ctx.lineTo(s.x - arrOff - headLen, s.y - headHW);
      ctx.lineTo(s.x - arrOff - headLen, s.y + headHW);
      ctx.closePath();
      ctx.fillStyle = '#e3b341';
      ctx.fill();
      ctx.restore();
    }

    // Labels
    const fontSize = Math.max(8, Math.min(13, 11 * state.zoom));
    const drawLabel = (text, lx, ly, font, color) => {
      ctx.save();
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      if (isFocused) {
        const tw = ctx.measureText(text).width;
        const pad = 4;
        const bh = fontSize + pad * 2;
        ctx.fillStyle = 'rgba(13, 17, 23, 0.82)';
        const rx = lx - tw / 2 - pad, ry = ly - fontSize - pad, rw = tw + pad * 2;
        ctx.beginPath();
        ctx.roundRect(rx, ry, rw, bh, 3);
        ctx.fill();
      }
      ctx.fillStyle = color;
      ctx.fillText(text, lx, ly);
      ctx.restore();
    };
    if (node.depth === 0) {
      drawLabel(node.name, s.x, s.y + sr + fontSize + 4,
        `bold ${fontSize + 2}px "Cascadia Code", "Fira Code", monospace`, '#f0883e');
    } else if (node.depth === 1 || state.zoom > 1.5) {
      drawLabel(node.name, s.x, s.y - sr - 4,
        `${fontSize}px "Cascadia Code", "Fira Code", monospace`,
        node.isLeaf ? 'rgba(126, 231, 135, 0.8)' : 'rgba(201, 209, 217, 0.8)');
    }

  });
}

// --- View helpers ---
export function saveView() {
  localStorage.setItem(nsKey('hub-tree-view'), JSON.stringify({ camX: state.camX, camY: state.camY, zoom: state.zoom }));
}

export function loadView() {
  try {
    const v = JSON.parse(localStorage.getItem(nsKey('hub-tree-view')));
    if (v) { state.camX = v.camX; state.camY = v.camY; state.zoom = v.zoom; }
    else { state.camX = 0; state.camY = 0; state.zoom = 1; }
  } catch (e) { state.camX = 0; state.camY = 0; state.zoom = 1; }
}

export function savePinned() {
  localStorage.setItem(nsKey('hub-tree-pinned-collapsed'), JSON.stringify([...state.pinnedCollapsed]));
}

export function loadPinned() {
  try {
    const _saved = localStorage.getItem(nsKey('hub-tree-pinned-collapsed'));
    if (_saved) state.pinnedCollapsed = new Set(JSON.parse(_saved));
    else state.pinnedCollapsed = new Set();
  } catch (e) { state.pinnedCollapsed = new Set(); }
}

export function saveFocus() {
  if (state.focusedPath) localStorage.setItem(nsKey('hub-tree-focus'), state.focusedPath);
  else localStorage.removeItem(nsKey('hub-tree-focus'));
}

export function loadFocus() {
  state.focusedPath = localStorage.getItem(nsKey('hub-tree-focus')) || null;
}

export function getVisibleCenter() {
  const pw = ccmdPanel.style.display === 'flex' ? (parseInt(ccmdPanel.style.width) || 420) : 0;
  let cx = state.W / 2;
  if (pw > 0) {
    cx = state.panelSide === 'left' ? pw + (state.W - pw) / 2 : (state.W - pw) / 2;
  }
  return { x: cx, y: state.H / 2 };
}

export function centerOnNode(path) {
  // Auto-expand collapsed ancestors if needed
  let n = state.nodes.find(nd => nd.path === path);
  if (!n) {
    const parts = path.split('/');
    let ancestor = parts[0];
    for (let i = 1; i < parts.length; i++) {
      if (state.collapsed.has(ancestor)) state.collapsed.delete(ancestor);
      ancestor += '/' + parts[i];
    }
    layout();
    n = state.nodes.find(nd => nd.path === path);
    if (!n) return;
  }
  const vc = getVisibleCenter();
  state.camX = (vc.x - state.W / 2) / state.zoom - n.x;
  state.camY = (vc.y - state.H / 2) / state.zoom - n.y;
  draw();
  saveView();
}

// --- Context menu ---
function showCtxMenu(x, y, nodePath, mdFiles, isLeaf) {
  ctxMenu.innerHTML = '';

  // Current focus toggle
  const isFocused = state.focusedPath === nodePath;
  const focusItem = document.createElement('div');
  focusItem.className = 'ctx-item';
  focusItem.textContent = (isFocused ? '✓ ' : '  ') + 'Current focus';
  focusItem.addEventListener('click', () => {
    ctxMenu.style.display = 'none';
    state.focusedPath = isFocused ? null : nodePath;
    saveFocus();
    draw();
  });
  ctxMenu.appendChild(focusItem);
  {
    const sep = document.createElement('div');
    sep.style.cssText = 'border-top: 1px solid #21262d; margin: 4px 0;';
    ctxMenu.appendChild(sep);
  }

  if (!isLeaf) {
    const isPinned = state.pinnedCollapsed.has(nodePath);
    const pinItem = document.createElement('div');
    pinItem.className = 'ctx-item';
    pinItem.textContent = (isPinned ? '✓ ' : '  ') + 'Collapse by default';
    pinItem.addEventListener('click', () => {
      ctxMenu.style.display = 'none';
      if (isPinned) state.pinnedCollapsed.delete(nodePath);
      else state.pinnedCollapsed.add(nodePath);
      savePinned();
    });
    ctxMenu.appendChild(pinItem);
    if (mdFiles.length > 0) {
      const sep = document.createElement('div');
      sep.style.cssText = 'border-top: 1px solid #21262d; margin: 4px 0;';
      ctxMenu.appendChild(sep);
    }
  }

  if (mdFiles.length === 0 && isLeaf) {
    const empty = document.createElement('div');
    empty.className = 'ctx-empty';
    empty.textContent = 'No .md files';
    ctxMenu.appendChild(empty);
  } else if (mdFiles.length === 0 && !isLeaf) {
    // no md files, pin item already added
  } else {
    mdFiles.forEach(f => {
      const item = document.createElement('div');
      item.className = 'ctx-item';
      item.textContent = f;
      item.addEventListener('click', async () => {
        ctxMenu.style.display = 'none';
        const content = await readMdFile(nodePath, f);
        if (content !== null) {
          state.selectedNodePath = nodePath;
          state.selectedFileName = f;
          ccmdTitle.textContent = nodePath + '/' + f;
          ccmdBody.innerHTML = _renderMarkdown(content);
          ccmdPanel.style.display = 'flex';
          _jumpPush(nodePath, f);
          _saveMdv();
          _updateToolbar();
        }
      });
      ctxMenu.appendChild(item);
    });
  }
  // Position: keep menu within viewport
  ctxMenu.style.display = 'block';
  const rect = ctxMenu.getBoundingClientRect();
  ctxMenu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + 'px';
  ctxMenu.style.top = Math.min(y, window.innerHeight - rect.height - 8) + 'px';
}

// --- Init from cache ---
loadView();
loadPinned();
loadFocus();

const cached = localStorage.getItem(nsKey('hub-tree-data'));
if (cached) {
  try {
    state.treeData = JSON.parse(cached);
    promptEl.style.display = 'none';
    layout(true);
    draw();
  } catch (e) {
    localStorage.removeItem(nsKey('hub-tree-data'));
  }
}

// --- Restore dirHandle from IndexedDB on load ---
(async () => {
  if (!state.activeRoot) return;
  try {
    const handle = await loadHandle(state.activeRoot);
    if (!handle) return;
    let perm = await handle.queryPermission({ mode: 'read' });
    if (perm !== 'granted') perm = await handle.requestPermission({ mode: 'read' });
    if (perm === 'granted') {
      state.dirHandle = handle;
      // Restore mdv viewing state
      try {
        const s = JSON.parse(localStorage.getItem(nsKey('hub-tree-mdv')));
        if (s && s.viewPath && s.viewFile) {
          const content = await readMdFile(s.viewPath, s.viewFile);
          if (content !== null) {
            state.selectedNodePath = s.viewPath;
            state.selectedFileName = s.viewFile;
            ccmdTitle.textContent = s.viewPath + '/' + s.viewFile;
            ccmdBody.innerHTML = _renderMarkdown ? _renderMarkdown(content) : content;
            ccmdPanel.style.display = 'flex';
          }
        }
      } catch (e) {}
    }
  } catch (e) {}
})();

// --- Folder picker button ---
document.getElementById('pickBtn').addEventListener('click', pickAndScan);

// --- Zoom ---
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const oldZoom = state.zoom;
  const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
  state.zoom = Math.max(0.2, Math.min(10, state.zoom * zoomFactor));

  const mx = e.clientX, my = e.clientY;
  const wx = (mx - state.W / 2) / oldZoom - state.camX;
  const wy = (my - state.H / 2) / oldZoom - state.camY;
  state.camX = (mx - state.W / 2) / state.zoom - wx;
  state.camY = (my - state.H / 2) / state.zoom - wy;

  draw();
  saveView();
}, { passive: false });

// --- Pan & Click ---
canvas.addEventListener('mousedown', e => {
  state.dragging = true;
  state.dragStartX = e.clientX;
  state.dragStartY = e.clientY;
  state.clickStartX = e.clientX;
  state.clickStartY = e.clientY;
  state.camStartX = state.camX;
  state.camStartY = state.camY;
});

canvas.addEventListener('mousemove', e => {
  if (state.dragging) {
    state.camX = state.camStartX + (e.clientX - state.dragStartX) / state.zoom;
    state.camY = state.camStartY + (e.clientY - state.dragStartY) / state.zoom;
    draw();
  }

  const world = toWorld(e.clientX, e.clientY);
  let found = null;
  for (let i = state.nodes.length - 1; i >= 0; i--) {
    const n = state.nodes[i];
    const dx = world.x - n.x, dy = world.y - n.y;
    const hitR = n.r + 4 / state.zoom;
    if (dx * dx + dy * dy < hitR * hitR) { found = n; break; }
  }
  if (found) {
    state.hoveredPath = found.path;
    tooltip.style.display = 'block';
    tooltip.style.left = (e.clientX + 14) + 'px';
    tooltip.style.top = (e.clientY - 8) + 'px';
    tooltip.textContent = found.path;
  } else {
    state.hoveredPath = null;
    tooltip.style.display = 'none';
  }
});

canvas.addEventListener('mouseup', async e => {
  state.dragging = false;
  saveView();
  if (e.button !== 0) return; // left-click only
  const dx = e.clientX - state.clickStartX, dy = e.clientY - state.clickStartY;
  if (dx * dx + dy * dy < 9) {
    const world = toWorld(e.clientX, e.clientY);
    for (let i = state.nodes.length - 1; i >= 0; i--) {
      const n = state.nodes[i];
      if (!isVisible(i)) continue;
      const ddx = world.x - n.x, ddy = world.y - n.y;
      const hitR = n.r + 4 / state.zoom;
      if (ddx * ddx + ddy * ddy < hitR * hitR) {
        if (!findHasCcmd(n.path)) break;
        state.selectedNodePath = n.path;
        state.selectedFileName = 'CLAUDE.md';
        const content = await readMdFile(n.path, 'CLAUDE.md');
        if (content !== null) {
          ccmdTitle.textContent = n.path + '/CLAUDE.md';
          ccmdBody.innerHTML = _renderMarkdown(content);
        }
        ccmdPanel.style.display = 'flex';
        _jumpPush(n.path, 'CLAUDE.md');
        _saveMdv();
        _updateToolbar();
        break;
      }
    }
  }
});
canvas.addEventListener('mouseleave', () => { state.dragging = false; tooltip.style.display = 'none'; });

// --- Middle-click: expand/collapse + double-click reset ---
canvas.addEventListener('mousedown', e => {
  if (e.button !== 1) return;
  e.preventDefault();
  const now = Date.now();
  if (now - state.lastMidClick < 350) {
    state.zoom = 1;
    const vc = getVisibleCenter();
    state.camX = (vc.x - state.W / 2) / state.zoom;
    state.camY = (vc.y - state.H / 2) / state.zoom;
    draw();
    saveView();
    showStatus('View reset');
    state.lastMidClick = 0;
    return;
  }
  state.lastMidClick = now;
  const world = toWorld(e.clientX, e.clientY);
  for (let i = state.nodes.length - 1; i >= 0; i--) {
    const n = state.nodes[i];
    if (!isVisible(i)) continue;
    const dx = world.x - n.x, dy = world.y - n.y;
    const hitR = n.r + 4 / state.zoom;
    if (dx * dx + dy * dy < hitR * hitR) {
      if (!n.isLeaf) {
        if (state.collapsed.has(n.path)) state.collapsed.delete(n.path);
        else state.collapsed.add(n.path);
        layout();
        draw();
      }
      break;
    }
  }
});

// --- Right-click: context menu with .md files ---
canvas.addEventListener('contextmenu', async e => {
  e.preventDefault();
  ctxMenu.style.display = 'none';
  const world = toWorld(e.clientX, e.clientY);
  for (let i = state.nodes.length - 1; i >= 0; i--) {
    const n = state.nodes[i];
    if (!isVisible(i)) continue;
    const dx = world.x - n.x, dy = world.y - n.y;
    const hitR = n.r + 4 / state.zoom;
    if (dx * dx + dy * dy < hitR * hitR) {
      const mdFiles = await listMdFiles(n.path);
      showCtxMenu(e.clientX, e.clientY, n.path, mdFiles, n.isLeaf);
      break;
    }
  }
});

// Dismiss context menu on click outside
document.addEventListener('mousedown', e => {
  if (!ctxMenu.contains(e.target)) ctxMenu.style.display = 'none';
});

// --- Ccmd panel resize drag ---
let ccmdDragging = false;
ccmdDrag.addEventListener('mousedown', e => {
  e.preventDefault();
  ccmdDragging = true;
  ccmdDrag.classList.add('active');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
});
document.addEventListener('mousemove', e => {
  if (!ccmdDragging) return;
  const newWidth = state.panelSide === 'left'
    ? Math.max(200, Math.min(window.innerWidth - 100, e.clientX))
    : Math.max(200, Math.min(window.innerWidth - 100, window.innerWidth - e.clientX));
  ccmdPanel.style.width = newWidth + 'px';
});
document.addEventListener('mouseup', () => {
  if (ccmdDragging) {
    ccmdDragging = false;
    ccmdDrag.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    _saveMdv();
  }
});

// --- Window resize handler ---
window.addEventListener('resize', () => { if (state.treeData) draw(); });
