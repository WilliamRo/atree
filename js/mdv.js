// mdv.js — markdown renderer, viewer panel, toolbar, address bar, jump list
import {
  state, ccmdPanel, ccmdTitle, ccmdBody, ctxMenu, helpPanel, hintEl, ccmdDrag, nsKey,
  readMdFile, listMdFiles, writeMdFile, showStatus, setActiveRoot, saveHandle, getTopChildren, saveHistory, loadHistory,
} from './core.js';
import {
  setMdvCallbacks, draw, layout, centerOnNode, saveView, scanAndRender,
  loadView, loadPinned, loadFocus, findHasCcmd,
} from './tree.js';

// --- Minimal markdown renderer ---

export function renderMarkdown(md) {
  const lines = md.split('\n');
  let html = '';
  let inList = false;
  let inCode = false;
  let codeBuf = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fenced code block
    if (line.trimStart().startsWith('```')) {
      if (inCode) {
        html += `<pre><code>${escHtml(codeBuf.trimEnd())}</code></pre>`;
        codeBuf = '';
        inCode = false;
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeBuf += line + '\n'; continue; }

    // Empty line
    if (line.trim() === '') {
      if (inList) { html += '</ul>'; inList = false; }
      continue;
    }

    // Blockquote
    if (line.trimStart().startsWith('> ') || line.trim() === '>') {
      if (inList) { html += '</ul>'; inList = false; }
      const bqLines = [line.replace(/^\s*>\s?/, '')];
      while (i + 1 < lines.length && (lines[i + 1].trimStart().startsWith('> ') || lines[i + 1].trim() === '>')) {
        bqLines.push(lines[++i].replace(/^\s*>\s?/, ''));
      }
      html += '<blockquote>' + bqLines.map(l => l.trim() === '' ? '<br>' : inlineMd(l)).join('<br>') + '</blockquote>';
      continue;
    }

    // Headings
    const hMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (hMatch) {
      if (inList) { html += '</ul>'; inList = false; }
      const lvl = hMatch[1].length;
      html += `<h${lvl}>${inlineMd(hMatch[2])}</h${lvl}>`;
      continue;
    }

    // Table
    if (line.includes('|') && line.trim().startsWith('|')) {
      if (inList) { html += '</ul>'; inList = false; }
      const tableLines = [line];
      while (i + 1 < lines.length && lines[i + 1].includes('|') && lines[i + 1].trim().startsWith('|')) {
        tableLines.push(lines[++i]);
      }
      html += renderTable(tableLines);
      continue;
    }

    // List item
    if (line.match(/^\s*[-*]\s/)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inlineMd(line.replace(/^\s*[-*]\s/, ''))}</li>`;
      continue;
    }

    // Paragraph
    if (inList) { html += '</ul>'; inList = false; }
    html += `<p>${inlineMd(line)}</p>`;
  }

  if (inList) html += '</ul>';
  if (inCode) html += `<pre><code>${escHtml(codeBuf.trimEnd())}</code></pre>`;
  return html;
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineMd(s) {
  s = escHtml(s);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/`(.+?)`/g, '<code>$1</code>');
  s = s.replace(/\[([^\]]+)\]\((hub\/[^)]+)\)/g, '<a href="#" data-hub-link="$2" class="hub-link" title="$2">$1</a>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}

function renderTable(lines) {
  const rows = lines
    .filter(l => !l.match(/^\s*\|[\s-:|]+\|\s*$/))
    .map(l => l.split('|').slice(1, -1).map(c => c.trim()));
  if (rows.length === 0) return '';
  let html = '<table>';
  html += '<tr>' + rows[0].map(c => `<th>${inlineMd(c)}</th>`).join('') + '</tr>';
  for (let i = 1; i < rows.length; i++) {
    html += '<tr>' + rows[i].map(c => `<td>${inlineMd(c)}</td>`).join('') + '</tr>';
  }
  return html + '</table>';
}

// --- Mdv state save/load ---

export function saveMdv() {
  localStorage.setItem(nsKey('hub-tree-mdv'), JSON.stringify({
    side: state.panelSide,
    width: parseInt(ccmdPanel.style.width) || 420,
    fontSize: state.ccmdFontSize,
    viewPath: state.selectedNodePath,
    viewFile: state.selectedFileName
  }));
}

function loadMdv() {
  try {
    const s = JSON.parse(localStorage.getItem(nsKey('hub-tree-mdv')));
    if (!s) return;
    if (s.fontSize) { state.ccmdFontSize = s.fontSize; ccmdPanel.style.fontSize = state.ccmdFontSize + 'px'; }
    if (s.width) ccmdPanel.style.width = s.width + 'px';
    if (s.side) state.panelSide = s.side;
  } catch (e) {}
}

// --- Jump list ---

export function jumpPush(path, file) {
  if (state.jumpIdx >= 0 && state.jumpIdx < state.jumpList.length) {
    const cur = state.jumpList[state.jumpIdx];
    if (cur.path === path && cur.file === file) return;
  }
  state.jumpList = state.jumpList.slice(0, state.jumpIdx + 1);
  state.jumpList.push({ path, file });
  state.jumpIdx = state.jumpList.length - 1;
  saveJumpList();
}

function loadJumpList() {
  try {
    const s = JSON.parse(localStorage.getItem(nsKey('hub-tree-jumplist')));
    if (s) { state.jumpList = s.list || []; state.jumpIdx = s.idx ?? -1; }
    else { state.jumpList = []; state.jumpIdx = -1; }
  } catch (e) { state.jumpList = []; state.jumpIdx = -1; }
}

function saveJumpList() {
  localStorage.setItem(nsKey('hub-tree-jumplist'), JSON.stringify({ list: state.jumpList, idx: state.jumpIdx }));
}

async function jumpTo(entry) {
  if (!state.dirHandle) return;
  const content = await readMdFile(entry.path, entry.file);
  if (content === null) return;
  state.selectedNodePath = entry.path;
  state.selectedFileName = entry.file;
  ccmdTitle.textContent = entry.path + '/' + entry.file;
  ccmdBody.innerHTML = renderMarkdown(content);
  ccmdPanel.style.display = 'flex';
  saveMdv();
  centerOnNode(entry.path);
  updateToolbar();
}

// --- Reload ---

export async function reloadCcmd() {
  if (!state.dirHandle || !state.selectedNodePath || ccmdPanel.style.display === 'none') return;
  const fname = state.selectedFileName || 'CLAUDE.md';
  try {
    const content = await readMdFile(state.selectedNodePath, fname);
    if (content === null) return;
    ccmdTitle.textContent = state.selectedNodePath + '/' + fname;
    ccmdBody.innerHTML = renderMarkdown(content);
    showStatus(fname + ' reloaded');
    updateToolbar();
  } catch (e) {}
}

// --- Restore root state ---

export async function restoreRootState() {
  loadView();
  loadPinned();
  loadFocus();
  loadJumpList();
  loadMdv();
  // Restore mdv panel content
  state.selectedNodePath = null;
  state.selectedFileName = null;
  ccmdPanel.style.display = 'none';
  try {
    const s = JSON.parse(localStorage.getItem(nsKey('hub-tree-mdv')));
    if (s && s.viewPath && s.viewFile) {
      const content = await readMdFile(s.viewPath, s.viewFile);
      if (content !== null) {
        state.selectedNodePath = s.viewPath;
        state.selectedFileName = s.viewFile;
        ccmdTitle.textContent = s.viewPath + '/' + s.viewFile;
        ccmdBody.innerHTML = renderMarkdown(content);
        ccmdPanel.style.display = 'flex';
      }
    }
  } catch (e) {}
}

// --- Render history ---

export async function renderHistory() {
  const historyEl = document.getElementById('root-history');
  const history = await loadHistory();
  if (history.length === 0) { historyEl.innerHTML = ''; return; }
  historyEl.innerHTML = '<div class="history-label">Recent</div>' +
    history.map((h, i) => '<div class="history-item" data-idx="' + i + '">' +
      '<div class="history-name">' + h.name + '</div>' +
      '<div class="history-ctx">' + (h.context || '') + '</div></div>').join('');
  historyEl.querySelectorAll('.history-item').forEach(el => {
    el.addEventListener('click', async () => {
      const idx = parseInt(el.dataset.idx);
      const entry = history[idx];
      if (!entry || !entry.handle) return;
      try {
        let perm = await entry.handle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') perm = await entry.handle.requestPermission({ mode: 'readwrite' });
        if (perm === 'granted') {
          state.dirHandle = entry.handle;
          setActiveRoot(state.dirHandle.name);
          await saveHandle(state.dirHandle);
          const ctx = await getTopChildren(state.dirHandle);
          await saveHistory(state.dirHandle, ctx);
          await scanAndRender();
          await restoreRootState();
        }
      } catch (e) { showStatus('Cannot access folder'); }
    });
  });
}

// --- Toolbar ---

const tbBack = document.getElementById('tb-back');
const tbFwd = document.getElementById('tb-fwd');
const tbRefresh = document.getElementById('tb-refresh');
const tbFontDec = document.getElementById('tb-font-dec');
const tbFontInc = document.getElementById('tb-font-inc');
const tbFontSize = document.getElementById('tb-font-size');

export function updateToolbar() {
  tbBack.disabled = state.jumpIdx <= 0;
  tbFwd.disabled = state.jumpIdx >= state.jumpList.length - 1;
  tbFontSize.textContent = state.ccmdFontSize;
  buildAddrBar();
}

tbBack.addEventListener('click', () => {
  if (state.editMode) return;
  if (state.jumpIdx > 0) { state.jumpIdx--; saveJumpList(); jumpTo(state.jumpList[state.jumpIdx]); }
});
tbFwd.addEventListener('click', () => {
  if (state.editMode) return;
  if (state.jumpIdx < state.jumpList.length - 1) { state.jumpIdx++; saveJumpList(); jumpTo(state.jumpList[state.jumpIdx]); }
});
tbRefresh.addEventListener('click', () => { if (!state.editMode) reloadCcmd(); });
tbFontDec.addEventListener('click', () => {
  state.ccmdFontSize = Math.max(8, state.ccmdFontSize - 1);
  ccmdPanel.style.fontSize = state.ccmdFontSize + 'px';
  saveMdv();
  updateToolbar();
});
tbFontInc.addEventListener('click', () => {
  state.ccmdFontSize = Math.min(24, state.ccmdFontSize + 1);
  ccmdPanel.style.fontSize = state.ccmdFontSize + 'px';
  saveMdv();
  updateToolbar();
});

// Auto-update toolbar when panel becomes visible
new MutationObserver(() => {
  if (ccmdPanel.style.display === 'flex') updateToolbar();
}).observe(ccmdPanel, { attributes: true, attributeFilter: ['style'] });

// --- Address bar ---

const addrBarInner = document.getElementById('addr-bar-inner');
const addrDropdown = document.getElementById('addr-dropdown');

function truncName(name, max) {
  if (!max) max = 16;
  if (name.length <= max) return name;
  if (name.endsWith('.md')) {
    return name.slice(0, max - 4) + '….md';
  }
  return name.slice(0, max - 1) + '…';
}

function isLeafPath(path) {
  if (!state.treeData) return true;
  let node = state.treeData;
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) {
    if (!node.children) return true;
    node = node.children.find(c => c.name === parts[i]);
    if (!node) return true;
  }
  return !node.children || node.children.length === 0;
}

function getSiblingNodes(path) {
  if (!state.treeData) return [];
  const parts = path.split('/');
  if (parts.length <= 1) return [];
  let parent = state.treeData;
  for (let i = 1; i < parts.length - 1; i++) {
    if (!parent.children) return [];
    parent = parent.children.find(c => c.name === parts[i]);
    if (!parent) return [];
  }
  return (parent.children || []).map(c => c.name);
}

export function getChildNodes(path) {
  if (!state.treeData) return [];
  let node = state.treeData;
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) {
    if (!node.children) return [];
    node = node.children.find(c => c.name === parts[i]);
    if (!node) return [];
  }
  return (node.children || []).map(c => c.name);
}

export function nodeHasCcmd(path) {
  if (!state.treeData) return false;
  let node = state.treeData;
  const parts = path.split('/');
  for (let i = 1; i < parts.length; i++) {
    if (!node.children) return false;
    node = node.children.find(c => c.name === parts[i]);
    if (!node) return false;
  }
  return true;
}

export async function findFirstMdNode(path) {
  const mds = await listMdFiles(path);
  if (mds.length > 0) {
    const first = mds.includes('CLAUDE.md') ? 'CLAUDE.md' : mds[0];
    return { path, file: first };
  }
  const children = getChildNodes(path);
  for (const cn of children) {
    const childPath = path + '/' + cn;
    if (!nodeHasCcmd(childPath)) continue;
    const result = await findFirstMdNode(childPath);
    if (result) return result;
  }
  return null;
}

function buildAddrBar() {
  const addrBar = document.getElementById('addr-bar');
  if (!state.selectedNodePath || !state.selectedFileName) { addrBarInner.innerHTML = ''; return; }
  const parts = state.selectedNodePath.split('/');
  addrBarInner.innerHTML = '';
  addrBar.classList.remove('overflow');

  parts.forEach((name, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'addr-sep';
      sep.textContent = '/';
      addrBarInner.appendChild(sep);
    }
    const nodePath = parts.slice(0, i + 1).join('/');
    let cls = 'addr-seg';
    if (i === 0) cls += ' addr-root';
    else if (isLeafPath(nodePath)) cls += ' addr-leaf';
    else cls += ' addr-branch';
    const seg = document.createElement('span');
    seg.className = cls;
    seg.textContent = name;
    seg.title = name;
    seg.dataset.idx = i;
    seg.addEventListener('click', e => {
      e.stopPropagation();
      onAddrSegClick(seg, i, parts);
    });
    addrBarInner.appendChild(seg);
  });

  // File separator and file segment
  const sep = document.createElement('span');
  sep.className = 'addr-sep';
  sep.textContent = '/';
  addrBarInner.appendChild(sep);

  const fileSeg = document.createElement('span');
  fileSeg.className = 'addr-seg addr-file';
  fileSeg.textContent = state.selectedFileName;
  fileSeg.title = state.selectedFileName;
  fileSeg.addEventListener('click', e => {
    e.stopPropagation();
    onFileSegClick(fileSeg);
  });
  addrBarInner.appendChild(fileSeg);

  // Check overflow
  requestAnimationFrame(() => {
    addrBar.style.overflow = 'visible';
    const barW = addrBar.clientWidth;
    if (addrBarInner.scrollWidth > barW) {
      const segs = addrBarInner.querySelectorAll('.addr-seg');
      segs.forEach(s => { s.textContent = truncName(s.title); });
    }
    if (addrBarInner.scrollWidth > barW) {
      addrBar.classList.add('overflow');
    }
    addrBar.style.overflow = '';
  });
}

function showAddrDropdown(anchorId, anchor, items, onSelect) {
  if (anchorId === state.addrActiveId) {
    addrDropdown.style.display = 'none';
    state.addrActiveId = null;
    return;
  }
  if (Date.now() - state.addrCloseTime < 200 && addrDropdown._lastId === anchorId) {
    return;
  }
  state.addrActiveId = anchorId;
  const rect = anchor.getBoundingClientRect();
  addrDropdown.innerHTML = items.map(it => {
    if (it.isSep) return '<div class="addr-dd-sep">' + it.label + '</div>';
    const cls = 'addr-dd-item' + (it.cls ? ' ' + it.cls : '') + (it.disabled ? ' disabled' : '');
    return '<div class="' + cls + '" data-name="' +
      it.name.replace(/"/g, '&quot;') + '">' + truncName(it.name, 30) + '</div>';
  }).join('');
  addrDropdown.style.left = rect.left + 'px';
  addrDropdown.style.top = (rect.bottom + 2) + 'px';
  addrDropdown.style.display = 'block';
  addrDropdown.querySelectorAll('.addr-dd-item:not(.disabled)').forEach(el => {
    el.addEventListener('mousedown', e => {
      e.preventDefault();
      addrDropdown.style.display = 'none';
      state.addrActiveId = null;
      onSelect(el.dataset.name);
    });
  });
}

function hideAddrDropdown(e) {
  if (e && addrDropdown.contains(e.target)) return;
  if (addrDropdown.style.display === 'block') {
    addrDropdown._lastId = state.addrActiveId;
    state.addrCloseTime = Date.now();
  }
  addrDropdown.style.display = 'none';
  state.addrActiveId = null;
}
document.addEventListener('mousedown', e => {
  if (!addrDropdown.contains(e.target)) hideAddrDropdown();
});

async function onAddrSegClick(seg, idx, parts) {
  const anchorId = 'seg-' + idx;
  if (idx === 0) {
    const history = await loadHistory();
    if (history.length === 0) return;
    const items = history.map(h => ({
      name: h.name,
      cls: h.name === state.activeRoot ? 'current-root' : ''
    }));
    showAddrDropdown(anchorId, seg, items, async (name) => {
      const entry = history.find(h => h.name === name);
      if (!entry || !entry.handle) return;
      try {
        let perm = await entry.handle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') perm = await entry.handle.requestPermission({ mode: 'readwrite' });
        if (perm === 'granted') {
          state.dirHandle = entry.handle;
          setActiveRoot(state.dirHandle.name);
          await saveHandle(state.dirHandle);
          const ctx = await getTopChildren(state.dirHandle);
          await saveHistory(state.dirHandle, ctx);
          await scanAndRender();
          await restoreRootState();
        }
      } catch (e) { showStatus('Cannot access folder'); }
    });
    return;
  }
  const path = parts.slice(0, idx + 1).join('/');
  const parentPath = parts.slice(0, idx).join('/');
  const siblings = getSiblingNodes(path);
  if (siblings.length === 0) return;
  const items = siblings.map(name => {
    const sibPath = parentPath + '/' + name;
    const isCurrent = name === parts[idx];
    const leaf = isLeafPath(sibPath);
    return {
      name,
      cls: isCurrent ? (leaf ? 'current-leaf' : 'current-branch') : ''
    };
  });
  showAddrDropdown(anchorId, seg, items, async (name) => {
    const newPath = parentPath + '/' + name;
    const found = await findFirstMdNode(newPath);
    if (found) {
      const content = await readMdFile(found.path, found.file);
      if (content !== null) {
        state.selectedNodePath = found.path;
        state.selectedFileName = found.file;
        ccmdTitle.textContent = found.path + '/' + found.file;
        ccmdBody.innerHTML = renderMarkdown(content);
        ccmdPanel.style.display = 'flex';
        jumpPush(found.path, found.file);
        saveMdv();
        centerOnNode(found.path);
        buildAddrBar();
      }
    } else {
      showStatus('No .md files in ' + name);
    }
  });
}

async function onFileSegClick(seg) {
  if (!state.selectedNodePath) return;
  const mdFiles = await listMdFiles(state.selectedNodePath);

  const sorted = mdFiles.filter(f => f === 'CLAUDE.md').concat(mdFiles.filter(f => f !== 'CLAUDE.md'));
  const items = sorted.map(f => ({
    name: f,
    cls: f === state.selectedFileName ? 'current-file' : ''
  }));

  const childNames = getChildNodes(state.selectedNodePath);
  const leafChildren = [];
  for (const cn of childNames) {
    const childPath = state.selectedNodePath + '/' + cn;
    if (!nodeHasCcmd(childPath)) continue;
    const childMds = await listMdFiles(childPath);
    const firstMd = childMds.includes('CLAUDE.md') ? 'CLAUDE.md' : (childMds.length > 0 ? childMds[0] : 'CLAUDE.md');
    leafChildren.push({ name: cn, path: childPath, firstMd });
  }

  if (items.length === 0 && leafChildren.length === 0) return;

  if (leafChildren.length > 0) {
    items.push({ isSep: true, label: 'children' });
    for (const lc of leafChildren) {
      items.push({ name: lc.name, cls: '', isLeafChild: true, path: lc.path, firstMd: lc.firstMd });
    }
  }

  showAddrDropdown('seg-file', seg, items, async (name) => {
    const lc = leafChildren.find(c => c.name === name);
    if (lc) {
      const found = await findFirstMdNode(lc.path);
      if (found) {
        const content = await readMdFile(found.path, found.file);
        if (content !== null) {
          state.selectedNodePath = found.path;
          state.selectedFileName = found.file;
          ccmdTitle.textContent = found.path + '/' + found.file;
          ccmdBody.innerHTML = renderMarkdown(content);
          ccmdPanel.style.display = 'flex';
          jumpPush(found.path, found.file);
          saveMdv();
          centerOnNode(found.path);
          buildAddrBar();
        }
      }
      return;
    }
    const content = await readMdFile(state.selectedNodePath, name);
    if (content !== null) {
      state.selectedFileName = name;
      ccmdTitle.textContent = state.selectedNodePath + '/' + name;
      ccmdBody.innerHTML = renderMarkdown(content);
      jumpPush(state.selectedNodePath, name);
      saveMdv();
      buildAddrBar();
    }
  });
}

// --- Panel event listeners ---

document.getElementById('ccmd-close').addEventListener('click', () => {
  if (state.editMode) return; // block close during edit
  ccmdPanel.style.display = 'none';
  state.selectedNodePath = null;
  state.selectedFileName = null;
  saveMdv();
});

// Right-click on md viewer to reload
ccmdPanel.addEventListener('contextmenu', e => {
  e.preventDefault();
  reloadCcmd();
});

// Double-click mdv body to center on the current node
ccmdBody.addEventListener('dblclick', () => {
  if (state.selectedNodePath) centerOnNode(state.selectedNodePath);
});

// Hub cross-node links
ccmdBody.addEventListener('click', async e => {
  if (state.editMode) return;
  const link = e.target.closest('a[data-hub-link]');
  if (!link) return;
  e.preventDefault();
  const hubPath = link.dataset.hubLink;
  const parts = hubPath.split('/');
  const fileName = parts[parts.length - 1];
  const rootName = state.treeData ? state.treeData.name : '';
  const nodePath = rootName + '/' + parts.slice(1, -1).join('/');
  const content = await readMdFile(nodePath, fileName);
  if (content !== null) {
    state.selectedNodePath = nodePath;
    state.selectedFileName = fileName;
    ccmdTitle.textContent = nodePath + '/' + fileName;
    ccmdBody.innerHTML = renderMarkdown(content);
    jumpPush(nodePath, fileName);
    saveMdv();
    centerOnNode(nodePath);
    updateToolbar();
  } else {
    showStatus('File not found: ' + hubPath);
  }
});

// --- Init ---
loadMdv();
loadJumpList();

// Panel side init
if (state.panelSide === 'right') {
  ccmdPanel.style.right = '0'; ccmdPanel.style.left = 'auto';
  ccmdPanel.style.borderLeft = '1px solid #30363d'; ccmdPanel.style.borderRight = 'none';
  ccmdDrag.style.left = '-4px'; ccmdDrag.style.right = 'auto';
  helpPanel.style.right = 'auto'; helpPanel.style.left = '20px';
  hintEl.style.right = 'auto'; hintEl.style.left = '16px';
}

try { updateToolbar(); } catch (e) {}

// Render root history on selection page
renderHistory();

// Register callbacks with tree.js to break circular dependency
setMdvCallbacks({
  renderMarkdown,
  jumpPush,
  saveMdv,
  updateToolbar,
  reloadCcmd,
  renderHistory,
  restoreRootState,
});

// Export jumpTo and saveJumpList for commands.js
export { jumpTo, saveJumpList };

// --- Edit mode ---
const ccmdEditor = document.getElementById('ccmd-editor');
const btnEdit = document.getElementById('btn-edit');
const btnSave = document.getElementById('btn-save');
const btnCancel = document.getElementById('btn-cancel');

async function enterEditMode() {
  if (!state.selectedNodePath || !state.selectedFileName) return;
  if (!state.dirHandle) { showStatus('No folder access'); return; }
  // Ensure readwrite permission
  try {
    let perm = await state.dirHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') perm = await state.dirHandle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') { showStatus('Write permission denied'); return; }
  } catch (e) { showStatus('Permission error'); return; }
  const content = await readMdFile(state.selectedNodePath, state.selectedFileName);
  if (content === null) { showStatus('Cannot read file'); return; }
  state.editMode = true;
  state.editOriginal = content;
  ccmdEditor.value = content;
  ccmdBody.style.display = 'none';
  ccmdEditor.style.display = 'block';
  btnEdit.style.display = 'none';
  btnSave.style.display = '';
  btnSave.disabled = true;
  btnCancel.style.display = '';
  ccmdEditor.focus();
}

function exitEditMode() {
  state.editMode = false;
  state.editOriginal = null;
  ccmdEditor.style.display = 'none';
  ccmdBody.style.display = '';
  btnEdit.style.display = '';
  btnSave.style.display = 'none';
  btnCancel.style.display = 'none';
}

function hasUnsavedChanges() {
  return state.editMode && ccmdEditor.value !== state.editOriginal;
}

export function isEditMode() { return state.editMode; }
export function tryExitEditMode() {
  if (!state.editMode) return true;
  if (!hasUnsavedChanges()) { exitEditMode(); return true; }
  if (confirm('Discard unsaved changes?')) { exitEditMode(); return true; }
  return false;
}

ccmdEditor.addEventListener('input', () => {
  btnSave.disabled = ccmdEditor.value === state.editOriginal;
});

btnEdit.addEventListener('click', enterEditMode);

btnCancel.addEventListener('click', () => {
  if (hasUnsavedChanges()) {
    if (!confirm('Discard unsaved changes?')) return;
  }
  exitEditMode();
});

btnSave.addEventListener('click', async () => {
  if (!confirm('Overwrite "' + state.selectedFileName + '"?')) return;
  const ok = await writeMdFile(state.selectedNodePath, state.selectedFileName, ccmdEditor.value);
  if (ok) {
    showStatus('Saved: ' + state.selectedFileName);
    // Re-render with new content
    ccmdBody.innerHTML = renderMarkdown(ccmdEditor.value);
    exitEditMode();
  } else {
    showStatus('Save failed');
  }
});
