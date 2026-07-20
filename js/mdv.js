// mdv.js — markdown renderer, viewer panel, toolbar, address bar, tabs, jump list
import {
  state, ccmdPanel, ccmdTitle, ccmdBody, ctxMenu, helpPanel, hintEl, ccmdDrag, ccmdTabs, nsKey,
  readMdFile, listMdFiles, writeMdFile, getDirHandle, showStatus, setActiveRoot, saveHandle, getTopChildren, saveHistory, loadHistory,
} from './core.js';
import {
  setMdvCallbacks, draw, layout, centerOnNode, saveView, scanAndRender,
  loadView, loadPinned, loadFocus, findHasCcmd, findHasDf,
} from './tree.js';

// --- Minimal markdown renderer ---

export function renderMarkdown(md) {
  const lines = md.split('\n');
  let html = '';
  let inList = false;
  let listDepth = 0;
  let inCode = false;
  function closeList() {
    if (!inList) return;
    while (listDepth > 0) { html += '</ul>'; listDepth--; }
    html += '</ul>'; inList = false;
  }
  let codeBuf = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Display math block $$...$$
    if (line.trim().startsWith('$$')) {
      closeList();
      if (line.trim().endsWith('$$') && line.trim().length > 2) {
        // Single-line display math
        html += renderDisplayMath(line.trim().slice(2, -2));
      } else {
        // Multi-line: collect until closing $$
        const mathLines = [line.replace(/^\s*\$\$\s*/, '')];
        while (i + 1 < lines.length && !lines[i + 1].trim().endsWith('$$')) {
          mathLines.push(lines[++i]);
        }
        if (i + 1 < lines.length) {
          mathLines.push(lines[++i].replace(/\$\$\s*$/, ''));
        }
        html += renderDisplayMath(mathLines.join('\n').trim());
      }
      continue;
    }

    // Fenced code block
    if (line.trimStart().startsWith('```')) {
      if (inCode) {
        html += `<pre><code>${escHtml(codeBuf.trimEnd())}</code></pre>`;
        codeBuf = '';
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeBuf += line + '\n'; continue; }

    // Empty line
    if (line.trim() === '') {
      closeList();
      continue;
    }

    // Blockquote
    if (line.trimStart().startsWith('> ') || line.trim() === '>') {
      closeList();
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
      closeList();
      const lvl = hMatch[1].length;
      html += `<h${lvl}>${inlineMd(hMatch[2])}</h${lvl}>`;
      continue;
    }

    // Table
    if (line.includes('|') && line.trim().startsWith('|')) {
      closeList();
      const tableLines = [line];
      while (i + 1 < lines.length && lines[i + 1].includes('|') && lines[i + 1].trim().startsWith('|')) {
        tableLines.push(lines[++i]);
      }
      html += renderTable(tableLines);
      continue;
    }

    // Collapsible panel (cpanel): <details ...> ... </details>. Held out of the
    // paragraph path; the <summary> is emitted with inline markdown applied, and
    // the body is rendered recursively into a .panel-body. See design/mdv.md s9.1.
    if (line.trimStart().startsWith('<details')) {
      closeList();
      const openTag = line.trim();
      // Single-line <details>...</details> — pass through untouched.
      if (openTag.includes('</details>')) { html += openTag; continue; }
      // Collect the block up to the matching </details> (nesting-aware).
      const inner = [];
      let depth = 1;
      while (i + 1 < lines.length) {
        const l = lines[++i];
        const t = l.trim();
        if (t.startsWith('<details')) depth++;
        if (t.startsWith('</details>')) { depth--; if (depth === 0) break; }
        inner.push(l);
      }
      // Pull out the first <summary>...</summary> line; the rest is body markdown.
      // The summary is emitted verbatim (its inner HTML, e.g. <strong>, passes
      // through untouched), matching how the book authors panel summaries.
      let summary = '';
      const bodyLines = [];
      for (const l of inner) {
        if (!summary && l.trim().startsWith('<summary')) summary = l.trim();
        else bodyLines.push(l);
      }
      html += openTag + summary
        + '<div class="panel-body">' + renderMarkdown(bodyLines.join('\n')) + '</div>'
        + '</details>';
      continue;
    }

    // List item (supports nested indentation)
    if (line.match(/^\s*[-*]\s/)) {
      if (!inList) { inList = true; listDepth = 0; html += '<ul>'; }
      const indent = line.match(/^(\s*)/)[1].length;
      const depth = Math.floor(indent / 2);
      while (depth > listDepth) { html += '<ul>'; listDepth++; }
      while (depth < listDepth) { html += '</ul>'; listDepth--; }
      html += `<li>${inlineMd(line.replace(/^\s*[-*]\s/, ''))}</li>`;
      continue;
    }

    // Paragraph
    closeList();
    html += `<p>${inlineMd(line)}</p>`;
  }

  closeList();
  if (inCode) html += `<pre><code>${escHtml(codeBuf.trimEnd())}</code></pre>`;
  return html;
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderDisplayMath(tex) {
  if (typeof katex === 'undefined') return `<pre>${escHtml(tex)}</pre>`;
  try {
    return '<div class="math-display">' + katex.renderToString(tex, { displayMode: true, throwOnError: false }) + '</div>';
  } catch (e) { return `<pre>${escHtml(tex)}</pre>`; }
}

function renderInlineMath(tex) {
  if (typeof katex === 'undefined') return '$' + escHtml(tex) + '$';
  try {
    return katex.renderToString(tex, { displayMode: false, throwOnError: false });
  } catch (e) { return '$' + escHtml(tex) + '$'; }
}

function inlineMd(s) {
  // Extract inline code and math before escaping so emphasis does not affect them.
  const codeSlots = [];
  s = s.replace(/`([^`]+?)`/g, (_, code) => {
    const idx = codeSlots.length;
    codeSlots.push('<code>' + escHtml(code) + '</code>');
    return '\x00CODE' + idx + '\x00';
  });

  const mathSlots = [];
  s = s.replace(/\$([^\$]+?)\$/g, (_, tex) => {
    const idx = mathSlots.length;
    mathSlots.push(renderInlineMath(tex));
    return '\x00MATH' + idx + '\x00';
  });

  // Images — extract before emphasis/links so alt text and the surrounding
  // markdown processing never touch them. Two forms render as an image:
  //   ![alt](url)            — standard image syntax (any url)
  //   [text](url.png|jpg|…)  — a plain link whose target is an image file
  // Ordinary links (incl. .md hub links, .pdf, .zip) fall through to the link
  // passes below. Local paths get a placeholder hydrated async (see hydrateLocalImages).
  const imgSlots = [];
  s = s.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (m, bang, alt, url) => {
    if (!bang && !IMG_EXT.test(url)) return m; // ordinary link — leave for later passes
    const idx = imgSlots.length;
    imgSlots.push(buildImgHtml(alt, url));
    return '\x00IMG' + idx + '\x00';
  });

  s = escHtml(s);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^\s*](?:[^*\n]*?[^\s*])?)\*(?!\*)/g, '$1<em>$2</em>');
  // \comment{...} → inline red span (LaTeX-style annotation)
  s = s.replace(/\\comment\{([^}]+)\}/g, '<span class="md-comment">$1</span>');
  // \muted{...} → inline muted/gray span (e.g. translations, asides)
  s = s.replace(/\\muted\{([^}]+)\}/g, '<span class="md-muted">$1</span>');
  // Root-rooted cross-file md link: <root_marker>/<sub>/.../*.md
  // First segment is a root marker (any identifier without slash/paren/colon/whitespace);
  // it gets substituted with the active root name when the link is followed.
  s = s.replace(/\[([^\]]+)\]\(([^\/()\s:]+\/[^)]+\.md)\)/g, '<a href="#" data-hub-link="$2" class="hub-link" title="$2">$1</a>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, text, url) => {
    if (/\.(pdf|png|jpg|jpeg|gif|svg|zip|tar|gz)$/i.test(url)) {
      return '<span class="dead-link" title="Unsupported: ' + url + '">' + text + '</span>';
    }
    return '<a href="' + url + '" target="_blank" rel="noopener">' + text + '</a>';
  });
  // Restore protected inline spans.
  s = s.replace(/\x00CODE(\d+)\x00/g, (_, idx) => codeSlots[parseInt(idx)]);
  s = s.replace(/\x00MATH(\d+)\x00/g, (_, idx) => mathSlots[parseInt(idx)]);
  s = s.replace(/\x00IMG(\d+)\x00/g, (_, idx) => imgSlots[parseInt(idx)]);
  return s;
}

// Image file extensions: links targeting these render inline as images.
const IMG_EXT = /\.(png|jpe?g|gif|svg|webp|bmp|avif)$/i;

function escAttr(s) {
  return escHtml(s).replace(/"/g, '&quot;');
}

// Build an <img> tag. Remote URLs (http(s)://, protocol-relative //, data:)
// get a direct src. Local relative paths are deferred: emit a placeholder with
// the raw path in data-img-rel, filled in later by hydrateLocalImages.
function buildImgHtml(alt, url) {
  const altEsc = escAttr(alt);
  const isRemote = /^(https?:)?\/\//i.test(url) || /^data:/i.test(url);
  if (isRemote) {
    return `<img class="md-img" src="${escAttr(url)}" alt="${altEsc}" loading="lazy">`;
  }
  return `<img class="md-img md-img-local" data-img-rel="${escAttr(url)}" alt="${altEsc}">`;
}

// Candidate { dirPath, fileName } node coordinates for a local image path,
// in priority order. We don't guess relative-vs-root-rooted from syntax (a path
// like `ch09_src/x.png` is ambiguous); instead we list both and let the caller
// pick the first that exists on disk:
//   1. relative to baseNodePath (the .md file's directory) — honours '.', '..';
//   2. root-rooted (multi-segment only): first segment is a root marker,
//      substituted with the active root name, like mdv's hub .md cross-links.
function imgPathCandidates(baseNodePath, rel) {
  const cands = [];
  // (1) relative to the .md file's directory
  {
    const parts = baseNodePath.split('/');
    for (const seg of rel.split('/')) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') { if (parts.length > 1) parts.pop(); continue; }
      parts.push(seg);
    }
    const fileName = parts.pop();
    cands.push({ dirPath: parts.join('/'), fileName });
  }
  // (2) root-rooted — only for multi-segment paths not explicitly relative
  if (rel.includes('/') && !rel.startsWith('./') && !rel.startsWith('../')) {
    const rootName = state.treeData ? state.treeData.name : (baseNodePath.split('/')[0] || '');
    const segs = rel.split('/').filter(s => s !== '');
    const parts = [rootName, ...segs.slice(1)];
    const fileName = parts.pop();
    cands.push({ dirPath: parts.join('/'), fileName });
  }
  return cands;
}

async function readImgFile(cand) {
  const dir = await getDirHandle(cand.dirPath);
  if (!dir) return null;
  try {
    const fh = await dir.getFileHandle(cand.fileName);
    return await fh.getFile();
  } catch (e) { return null; }
}

// Object URLs created for the currently rendered local images. Revoked and
// rebuilt on every render so we never leak blob handles.
let localImgUrls = [];

// Resolve every local-image placeholder in `container` to a blob URL read from
// the file system, trying each candidate path until one exists on disk.
async function hydrateLocalImages(container, baseNodePath) {
  for (const url of localImgUrls) { try { URL.revokeObjectURL(url); } catch (e) {} }
  localImgUrls = [];
  if (!state.dirHandle || !baseNodePath) return;
  const imgs = container.querySelectorAll('img.md-img-local[data-img-rel]');
  for (const img of imgs) {
    const rel = img.getAttribute('data-img-rel');
    img.removeAttribute('data-img-rel');
    let file = null;
    for (const cand of imgPathCandidates(baseNodePath, rel)) {
      file = await readImgFile(cand);
      if (file) break;
    }
    if (file) {
      const objUrl = URL.createObjectURL(file);
      localImgUrls.push(objUrl);
      img.src = objUrl;
    } else {
      img.classList.add('md-img-broken');
      img.alt = (img.alt ? img.alt + ' ' : '') + '[missing: ' + rel + ']';
      img.title = 'Image not found: ' + rel;
    }
  }
}

// Render markdown into the viewer body, then hydrate any local images relative
// to nodePath. Single entry point so every render path picks up images.
function renderBody(content, nodePath) {
  ccmdBody.innerHTML = renderMarkdown(content);
  hydrateLocalImages(ccmdBody, nodePath);
}

function splitTableRow(line) {
  // Split on | but skip | inside backtick spans or $...$ math spans
  const cells = [];
  let cur = '';
  let inBt = false;
  let inMath = false;
  for (let j = 0; j < line.length; j++) {
    const ch = line[j];
    if (ch === '`' && !inMath) { inBt = !inBt; cur += ch; }
    else if (ch === '$' && !inBt) { inMath = !inMath; cur += ch; }
    else if (ch === '|' && !inBt && !inMath) { cells.push(cur); cur = ''; }
    else { cur += ch; }
  }
  cells.push(cur);
  // Remove first/last empty cells (leading/trailing |)
  if (cells.length > 0 && cells[0].trim() === '') cells.shift();
  if (cells.length > 0 && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map(c => c.trim());
}

function renderTable(lines) {
  const rows = lines
    .filter(l => !l.match(/^\s*\|[\s-:|]+\|\s*$/))
    .map(l => splitTableRow(l));
  if (rows.length === 0) return '';
  let html = '<table>';
  html += '<tr>' + rows[0].map(c => `<th>${inlineMd(c)}</th>`).join('') + '</tr>';
  for (let i = 1; i < rows.length; i++) {
    html += '<tr>' + rows[i].map(c => `<td>${inlineMd(c)}</td>`).join('') + '</tr>';
  }
  return html + '</table>';
}

// --- Tabs (active-tab mirror, persistence, switch/close, render) ---

function getActiveTab() {
  if (state.activeTabIdx < 0 || state.activeTabIdx >= state.tabs.length) return null;
  return state.tabs[state.activeTabIdx];
}

// Mirror active tab → state.selectedNodePath / selectedFileName / jumpList / jumpIdx
// (legacy fields used widely across the codebase).
function syncFromActiveTab() {
  const t = getActiveTab();
  if (!t) {
    state.selectedNodePath = null;
    state.selectedFileName = null;
    state.jumpList = [];
    state.jumpIdx = -1;
    return;
  }
  state.selectedNodePath = t.nodePath;
  state.selectedFileName = t.fileName;
  state.jumpList = t.jumpList;
  state.jumpIdx = t.jumpIdx;
}

// Inverse: copy mirror → active tab. Call after mutating jumpList/jumpIdx in place.
function commitToActiveTab() {
  const t = getActiveTab();
  if (!t) return;
  t.nodePath = state.selectedNodePath;
  t.fileName = state.selectedFileName;
  t.jumpList = state.jumpList;
  t.jumpIdx = state.jumpIdx;
}

// Open the active root's CLAUDE.md (or DESIGN.md fallback) in a new tab — the "+ button" homepage.
export async function openRootHome(opts) {
  opts = opts || {};
  if (!state.treeData) return false;
  const rootName = state.treeData.name;
  const fileName = findHasCcmd(rootName) ? 'CLAUDE.md' : (findHasDf(rootName) ? 'DESIGN.md' : null);
  if (!fileName) {
    showStatus('Root has no CLAUDE.md or DESIGN.md');
    return false;
  }
  return await openMd(rootName, fileName, { newTab: opts.newTab !== false, center: !!opts.center });
}

export function renderTabs() {
  if (!ccmdTabs) return;
  if (state.tabs.length === 0) {
    ccmdTabs.innerHTML = '';
    ccmdTabs.style.display = 'none';
    return;
  }
  ccmdTabs.style.display = 'flex';
  ccmdTabs.innerHTML = '';
  state.tabs.forEach((t, i) => {
    const tab = document.createElement('div');
    tab.className = 'ccmd-tab' + (i === state.activeTabIdx ? ' active' : '');
    tab.title = t.nodePath + '/' + t.fileName;
    const label = document.createElement('span');
    label.className = 'ccmd-tab-label';
    label.textContent = t.nodePath.split('/').pop();
    tab.appendChild(label);
    const close = document.createElement('span');
    close.className = 'ccmd-tab-close';
    close.textContent = '×';
    close.title = 'Close tab';
    close.addEventListener('mousedown', e => {
      e.stopPropagation();
      e.preventDefault();
      if (state.editMode) return;
      closeTab(i);
    });
    tab.appendChild(close);
    tab.addEventListener('click', () => {
      if (state.editMode) return;
      switchTab(i);
    });
    tab.addEventListener('mousedown', e => {
      if (e.button === 1) {
        e.preventDefault();
        if (state.editMode) return;
        closeTab(i);
      }
    });
    ccmdTabs.appendChild(tab);
  });
  // "+" button — opens root CLAUDE.md as a homepage in a new tab
  const plus = document.createElement('div');
  plus.className = 'ccmd-tab-new';
  plus.textContent = '+';
  plus.title = 'New tab (root homepage)';
  plus.addEventListener('click', () => {
    if (state.editMode) return;
    openRootHome({ newTab: true });
  });
  ccmdTabs.appendChild(plus);
  // Scroll active tab into view
  const activeEl = ccmdTabs.children[state.activeTabIdx];
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// Render the active tab's content into the body. Does not push to jumpList.
async function loadActiveTab() {
  const t = getActiveTab();
  if (!t) {
    ccmdPanel.style.display = 'none';
    renderTabs();
    return;
  }
  syncFromActiveTab();
  if (!state.dirHandle) {
    // Show stale title at least; content read deferred until handle restored
    ccmdTitle.textContent = t.nodePath + '/' + t.fileName;
    ccmdPanel.style.display = 'flex';
    renderTabs();
    updateToolbar();
    return;
  }
  const content = await readMdFile(t.nodePath, t.fileName);
  if (content === null) {
    showStatus('Cannot read: ' + t.nodePath + '/' + t.fileName);
  } else {
    ccmdTitle.textContent = t.nodePath + '/' + t.fileName;
    renderBody(content, t.nodePath);
  }
  ccmdPanel.style.display = 'flex';
  renderTabs();
  updateToolbar();
}

export async function switchTab(idx) {
  if (state.editMode) return;
  if (idx < 0 || idx >= state.tabs.length) return;
  if (idx === state.activeTabIdx) return;
  // Freeze the OUTGOING tab's mirror state into its slot before reassigning the index.
  // Skipping this lets saveMdv's auto-commit overwrite the new active tab with stale data.
  commitToActiveTab();
  state.activeTabIdx = idx;
  // Mirror the INCOMING tab so any save in this function (and inside loadActiveTab) is consistent.
  syncFromActiveTab();
  saveMdv();
  await loadActiveTab();
  const t = getActiveTab();
  if (t) centerOnNode(t.nodePath);
}

export function switchTabBy(delta) {
  if (state.editMode) return;
  const n = state.tabs.length;
  if (n < 2) return;
  let idx = state.activeTabIdx + delta;
  // Wrap around
  idx = ((idx % n) + n) % n;
  switchTab(idx);
}

export async function closeTab(idx) {
  if (state.editMode) return;
  if (idx < 0 || idx >= state.tabs.length) return;
  // If we're closing a non-active tab, the mirror still belongs to the active tab —
  // commit it first so its in-progress jumpIdx etc. is preserved across the splice.
  if (idx !== state.activeTabIdx) commitToActiveTab();
  state.tabs.splice(idx, 1);
  if (state.tabs.length === 0) {
    state.activeTabIdx = -1;
    syncFromActiveTab();
    ccmdPanel.style.display = 'none';
    saveMdv();
    renderTabs();
    return;
  }
  if (idx < state.activeTabIdx) {
    state.activeTabIdx--;
  } else if (idx === state.activeTabIdx) {
    if (state.activeTabIdx >= state.tabs.length) state.activeTabIdx = state.tabs.length - 1;
  }
  // Mirror now points at a different tab — refresh before any save so commit is a no-op.
  syncFromActiveTab();
  saveMdv();
  await loadActiveTab();
  const t = getActiveTab();
  if (t) centerOnNode(t.nodePath);
}

// Unified navigation entry point. opts: { newTab?: bool, center?: bool }
export async function openMd(nodePath, fileName, opts) {
  opts = opts || {};
  if (state.editMode) return false;
  if (!state.dirHandle) return false;
  const content = await readMdFile(nodePath, fileName);
  if (content === null) {
    showStatus('Cannot read: ' + nodePath + '/' + fileName);
    return false;
  }
  if (opts.newTab || state.tabs.length === 0 || state.activeTabIdx < 0) {
    state.tabs.push({
      nodePath, fileName,
      jumpList: [{ path: nodePath, file: fileName }],
      jumpIdx: 0,
    });
    state.activeTabIdx = state.tabs.length - 1;
  } else {
    const t = state.tabs[state.activeTabIdx];
    t.nodePath = nodePath;
    t.fileName = fileName;
    // Truncate forward history past current position, then push (skip duplicate at top)
    t.jumpList = t.jumpList.slice(0, t.jumpIdx + 1);
    const top = t.jumpList[t.jumpList.length - 1];
    if (!top || top.path !== nodePath || top.file !== fileName) {
      t.jumpList.push({ path: nodePath, file: fileName });
      t.jumpIdx = t.jumpList.length - 1;
    }
  }
  syncFromActiveTab();
  ccmdTitle.textContent = nodePath + '/' + fileName;
  renderBody(content, nodePath);
  ccmdPanel.style.display = 'flex';
  saveMdv();
  renderTabs();
  updateToolbar();
  if (opts.center) centerOnNode(nodePath);
  return true;
}

// --- Mdv state save/load ---

export function saveMdv() {
  // Mirror back to active tab before serializing
  commitToActiveTab();
  localStorage.setItem(nsKey('hub-tree-mdv'), JSON.stringify({
    side: state.panelSide,
    width: parseInt(ccmdPanel.style.width) || 420,
    fontSize: state.ccmdFontSize,
    tabs: state.tabs.map(t => ({
      nodePath: t.nodePath,
      fileName: t.fileName,
      jumpList: t.jumpList,
      jumpIdx: t.jumpIdx,
    })),
    activeTabIdx: state.activeTabIdx,
  }));
}

function loadMdv() {
  try {
    const s = JSON.parse(localStorage.getItem(nsKey('hub-tree-mdv')));
    if (!s) return;
    if (s.fontSize) { state.ccmdFontSize = s.fontSize; ccmdPanel.style.fontSize = state.ccmdFontSize + 'px'; }
    if (s.width) ccmdPanel.style.width = s.width + 'px';
    if (s.side) state.panelSide = s.side;
    if (Array.isArray(s.tabs)) {
      state.tabs = s.tabs
        .filter(t => t && t.nodePath && t.fileName)
        .map(t => ({
          nodePath: t.nodePath,
          fileName: t.fileName,
          jumpList: Array.isArray(t.jumpList) && t.jumpList.length > 0
            ? t.jumpList
            : [{ path: t.nodePath, file: t.fileName }],
          jumpIdx: typeof t.jumpIdx === 'number' ? t.jumpIdx : 0,
        }));
      state.activeTabIdx = (typeof s.activeTabIdx === 'number' && s.activeTabIdx >= 0 && s.activeTabIdx < state.tabs.length)
        ? s.activeTabIdx
        : (state.tabs.length > 0 ? 0 : -1);
    } else if (s.viewPath && s.viewFile) {
      // Migration from pre-tabs schema: single view (+ separate legacy jump list, if any)
      let jl = [{ path: s.viewPath, file: s.viewFile }];
      let ji = 0;
      try {
        const oldJ = JSON.parse(localStorage.getItem(nsKey('hub-tree-jumplist')));
        if (oldJ && Array.isArray(oldJ.list) && oldJ.list.length > 0) {
          jl = oldJ.list;
          ji = typeof oldJ.idx === 'number' ? oldJ.idx : (jl.length - 1);
        }
      } catch (e) {}
      state.tabs = [{ nodePath: s.viewPath, fileName: s.viewFile, jumpList: jl, jumpIdx: ji }];
      state.activeTabIdx = 0;
    }
    syncFromActiveTab();
  } catch (e) {}
}

// --- Jump list (per active tab) ---

export function jumpPush(path, file) {
  if (state.jumpIdx >= 0 && state.jumpIdx < state.jumpList.length) {
    const cur = state.jumpList[state.jumpIdx];
    if (cur.path === path && cur.file === file) return;
  }
  state.jumpList = state.jumpList.slice(0, state.jumpIdx + 1);
  state.jumpList.push({ path, file });
  state.jumpIdx = state.jumpList.length - 1;
  commitToActiveTab();
}

// Back-compat shim for callers that expect to persist after mutating jumpIdx in place.
function saveJumpList() {
  commitToActiveTab();
  saveMdv();
}

async function jumpTo(entry) {
  if (!state.dirHandle) return;
  const content = await readMdFile(entry.path, entry.file);
  if (content === null) return;
  state.selectedNodePath = entry.path;
  state.selectedFileName = entry.file;
  const t = getActiveTab();
  if (t) { t.nodePath = entry.path; t.fileName = entry.file; }
  ccmdTitle.textContent = entry.path + '/' + entry.file;
  renderBody(content, entry.path);
  ccmdPanel.style.display = 'flex';
  saveMdv();
  centerOnNode(entry.path);
  renderTabs();
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
    renderBody(content, state.selectedNodePath);
    showStatus(fname + ' reloaded');
    updateToolbar();
  } catch (e) {}
}

// --- Restore root state ---

export async function restoreRootState() {
  loadView();
  loadPinned();
  loadFocus();
  // Reset tabs/mirror before loading new root's persisted state
  state.tabs = [];
  state.activeTabIdx = -1;
  syncFromActiveTab();
  ccmdPanel.style.display = 'none';
  loadMdv();
  if (state.tabs.length > 0) {
    await loadActiveTab();
  } else {
    // Fresh root with nothing saved — auto-open homepage so the user lands somewhere
    await openRootHome({ newTab: true });
    renderTabs();
  }
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
  ccmdPanel.style.fontSize = state.ccmdFontSize + 'px';
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
    seg.addEventListener('mousedown', e => {
      if (e.button !== 1) return;
      e.preventDefault();
      e.stopPropagation();
      onAddrSegMiddleClick(i, parts);
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
  if (state.editMode) return;
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
  const parentMds = await listMdFiles(parentPath);
  const sortedParentMds = parentMds.filter(f => f === 'CLAUDE.md').concat(parentMds.filter(f => f !== 'CLAUDE.md'));
  if (siblings.length === 0 && sortedParentMds.length === 0) return;
  const items = siblings.map(name => {
    const sibPath = parentPath + '/' + name;
    const isCurrent = name === parts[idx];
    const leaf = isLeafPath(sibPath);
    return {
      name,
      cls: isCurrent ? (leaf ? 'current-leaf' : 'current-branch') : ''
    };
  });
  if (sortedParentMds.length > 0) {
    if (siblings.length > 0) items.push({ isSep: true, label: 'markdown' });
    for (const md of sortedParentMds) {
      const isCurrent = parentPath === state.selectedNodePath && md === state.selectedFileName;
      items.push({ name: md, cls: isCurrent ? 'current-file' : '' });
    }
  }
  showAddrDropdown(anchorId, seg, items, async (name) => {
    if (sortedParentMds.includes(name)) {
      await openMd(parentPath, name, { center: true });
      return;
    }
    const newPath = parentPath + '/' + name;
    const found = await findFirstMdNode(newPath);
    if (found) {
      await openMd(found.path, found.file, { center: true });
    } else {
      showStatus('No .md files in ' + name);
    }
  });
}

// Middle-click a breadcrumb segment: open that node's CLAUDE.md / DESIGN.md.
// If the open file is already this node's ccmd/df, toggle ccmd <-> df instead.
// Does nothing when the target file does not exist.
async function onAddrSegMiddleClick(idx, parts) {
  if (state.editMode) return;
  const path = parts.slice(0, idx + 1).join('/');
  const hasCcmd = findHasCcmd(path);
  const hasDf = findHasDf(path);
  if (!hasCcmd && !hasDf) return;
  const cur = state.selectedNodePath === path ? state.selectedFileName : null;
  let target;
  if (cur === 'CLAUDE.md') target = hasDf ? 'DESIGN.md' : null;
  else if (cur === 'DESIGN.md') target = hasCcmd ? 'CLAUDE.md' : null;
  else target = hasCcmd ? 'CLAUDE.md' : 'DESIGN.md';
  if (!target) return;
  await openMd(path, target, { center: true });
}

async function onFileSegClick(seg) {
  if (state.editMode) return;
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
      if (found) await openMd(found.path, found.file, { center: true });
      return;
    }
    if (state.selectedNodePath) await openMd(state.selectedNodePath, name);
  });
}

// --- Panel event listeners ---

document.getElementById('ccmd-close').addEventListener('click', () => {
  if (state.editMode) return; // block close during edit
  ccmdPanel.style.display = 'none';
  state.tabs = [];
  state.activeTabIdx = -1;
  syncFromActiveTab();
  saveMdv();
  renderTabs();
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

// Root-rooted cross-node links
ccmdBody.addEventListener('click', async e => {
  if (state.editMode) return;
  const link = e.target.closest('a[data-hub-link]');
  if (!link) return;
  e.preventDefault();
  const hubPath = link.dataset.hubLink;
  const parts = hubPath.split('/');
  const fileName = parts[parts.length - 1];
  const rootName = state.treeData ? state.treeData.name : '';
  const nodePath = rootName + (parts.length > 2 ? '/' + parts.slice(1, -1).join('/') : '');
  const ok = await openMd(nodePath, fileName, { newTab: e.ctrlKey || e.metaKey, center: true });
  if (!ok) showStatus('File not found: ' + hubPath);
});

// --- Init ---
loadMdv();
renderTabs();

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
  openMd,
  loadActiveTab,
  openRootHome,
});

// Export jumpTo and saveJumpList for commands.js
export { jumpTo, saveJumpList, loadActiveTab };

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
    renderBody(ccmdEditor.value, state.selectedNodePath);
    exitEditMode();
  } else {
    showStatus('Save failed');
  }
});
