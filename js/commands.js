// commands.js — command palette, find/goto/clear/open, global keyboard shortcuts
import {
  state, canvas, canvasCtx, ccmdPanel, ccmdTitle, ccmdBody, ctxMenu,
  helpPanel, hintEl, ccmdDrag, promptEl, statusEl, nsKey,
  SESSION_ROOT_KEY, showStatus, getStorageInfo, setActiveRoot,
  saveHandle, getTopChildren, saveHistory, loadHistory, loadHandle,
  readMdFile, listMdFiles,
} from './core.js';
import {
  pickAndScan, scanAndRender, rescan, draw, layout, centerOnNode,
  saveView, findHasCcmd, getVisibleCenter,
} from './tree.js';
import {
  renderMarkdown, saveMdv, jumpPush, updateToolbar, reloadCcmd,
  restoreRootState, jumpTo, saveJumpList,
  getChildNodes, nodeHasCcmd, findFirstMdNode,
} from './mdv.js';

// --- Command bar DOM refs ---
const cmdBar = document.getElementById('cmd-bar');
const cmdInput = document.getElementById('cmd-input');
const cmdShadow = document.getElementById('cmd-shadow');
const cmdDropdown = document.getElementById('cmd-dropdown');
const cmdList = ['find', 'clear', 'goto', 'help', 'manual', 'man', 'open', 'palette'];

// --- Command bar helpers ---

function updateGhost() {
  const val = cmdInput.value.toLowerCase();
  if (!val) {
    cmdShadow.innerHTML = '<span class="typed"></span><span class="ghost">find</span>';
    return;
  }
  const match = cmdList.find(c => c.startsWith(val) && c !== val);
  if (match) {
    cmdShadow.innerHTML = '<span class="typed">' + match.slice(0, val.length) + '</span><span class="ghost">' + match.slice(val.length) + '</span>';
  } else {
    cmdShadow.innerHTML = '';
  }
}

function highlightMatch(text, query) {
  const idx = text.toLowerCase().indexOf(query);
  if (idx < 0) return text;
  return text.slice(0, idx) + '<span class="cmd-hl">' + text.slice(idx, idx + query.length) + '</span>' + text.slice(idx + query.length);
}

function collectSearchableNodes() {
  return state.allNodes;
}

function scrollDropdownToActive() {
  const active = cmdDropdown.querySelector('.cmd-item.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

async function updateDropdown() {
  const val = cmdInput.value.trim().toLowerCase();
  const wrap = document.getElementById('cmd-wrap');

  // --- goto mode ---
  const gotoMatch = val.match(/^goto\s*(.*)/);
  if (gotoMatch !== null) {
    state.gotoMode = true;
    const query = (gotoMatch[1] || '').toLowerCase();
    const history = await loadHistory();
    state.dropdownItems = history
      .filter(h => !query || h.name.toLowerCase().includes(query) || (h.context || '').toLowerCase().includes(query))
      .map(h => ({ name: h.name, context: h.context || '', handle: h.handle, hlTerm: query, isGoto: true }));
    if (state.dropdownItems.length === 0) { cmdDropdown.style.display = 'none'; state.dropdownIdx = -1; wrap.classList.remove('has-dropdown'); return; }
    cmdDropdown.innerHTML = state.dropdownItems.map((h, i) => {
      const nameHtml = h.hlTerm ? highlightMatch(h.name, h.hlTerm) : h.name;
      const ctxHtml = h.hlTerm ? highlightMatch(h.context, h.hlTerm) : h.context;
      return '<div class="cmd-item' + (i === state.dropdownIdx ? ' active' : '') + '" data-idx="' + i + '">' +
        '<span class="cmd-name">' + nameHtml + '</span>' +
        '<span class="cmd-path">' + ctxHtml + '</span></div>';
    }).join('');
    cmdDropdown.style.display = 'block';
    wrap.classList.add('has-dropdown');
    cmdDropdown.querySelectorAll('.cmd-item').forEach(el => {
      el.addEventListener('mouseenter', () => {
        state.dropdownIdx = parseInt(el.dataset.idx);
        cmdDropdown.querySelectorAll('.cmd-item').forEach(x => x.classList.remove('active'));
        el.classList.add('active');
      });
      el.addEventListener('mousedown', e => {
        e.preventDefault();
        selectDropdownItem(parseInt(el.dataset.idx));
      });
    });
    return;
  }
  state.gotoMode = false;

  // --- find mode ---
  const findMatch = val.match(/^find\s+(.+)/);
  if (!findMatch) { cmdDropdown.style.display = 'none'; state.dropdownItems = []; state.dropdownIdx = -1; wrap.classList.remove('has-dropdown'); return; }
  const rawQuery = findMatch[1].toLowerCase();
  const browseMode = rawQuery.endsWith('/');
  const ccmdNodes = collectSearchableNodes();

  state.dropdownItems = [];
  if (browseMode) {
    const prefix = rawQuery.slice(0, -1);
    const matchingNodes = ccmdNodes.filter(n => n.path.toLowerCase().includes(prefix));
    for (const n of matchingNodes) {
      const children = ccmdNodes.filter(c => {
        const parts = c.path.split('/');
        parts.pop();
        return parts.join('/') === n.path;
      });
      for (const c of children) {
        state.dropdownItems.push({ name: c.name, path: c.path, hlTerm: '', isNode: true });
      }
    }
  } else {
    const lastSlash = rawQuery.lastIndexOf('/');
    if (lastSlash >= 0) {
      const pathPart = rawQuery.slice(0, lastSlash);
      const childFilter = rawQuery.slice(lastSlash + 1);
      const matchingNodes = ccmdNodes.filter(n => n.path.toLowerCase().includes(pathPart));
      for (const n of matchingNodes) {
        const children = ccmdNodes.filter(c => {
          const parts = c.path.split('/');
          parts.pop();
          return parts.join('/') === n.path;
        });
        for (const c of children) {
          if (childFilter && !c.name.toLowerCase().includes(childFilter)) continue;
          state.dropdownItems.push({ name: c.name, path: c.path, hlTerm: childFilter, isNode: true });
        }
      }
    } else {
      const matchingNodes = ccmdNodes.filter(n => n.path.toLowerCase().includes(rawQuery));
      const seen = new Set();
      for (const n of matchingNodes) {
        const mdFiles = await listMdFiles(n.path);
        const sorted = mdFiles.filter(f => f === 'CLAUDE.md').concat(mdFiles.filter(f => f !== 'CLAUDE.md'));
        for (const f of sorted) {
          const key = n.path + '/' + f;
          if (seen.has(key)) continue;
          seen.add(key);
          state.dropdownItems.push({ name: f, path: n.path, hlTerm: rawQuery });
        }
      }
    }
  }
  if (state.dropdownItems.length === 0) { cmdDropdown.style.display = 'none'; state.dropdownIdx = -1; wrap.classList.remove('has-dropdown'); return; }
  state.dropdownItems = state.dropdownItems.slice(0, 30);
  cmdDropdown.innerHTML = state.dropdownItems.map((f, i) => {
    const nameHtml = f.isNode ? highlightMatch(f.name, f.hlTerm) : f.name;
    const pathHtml = f.isNode ? f.path : highlightMatch(f.path, f.hlTerm);
    return '<div class="cmd-item' + (i === state.dropdownIdx ? ' active' : '') + '" data-idx="' + i + '">' +
      '<span class="cmd-name">' + nameHtml + '</span>' +
      '<span class="cmd-path">' + pathHtml + '</span></div>';
  }).join('');
  cmdDropdown.style.display = 'block';
  wrap.classList.add('has-dropdown');
  cmdDropdown.querySelectorAll('.cmd-item').forEach(el => {
    el.addEventListener('mouseenter', () => {
      state.dropdownIdx = parseInt(el.dataset.idx);
      cmdDropdown.querySelectorAll('.cmd-item').forEach(x => x.classList.remove('active'));
      el.classList.add('active');
    });
    el.addEventListener('mousedown', e => {
      e.preventDefault();
      selectDropdownItem(parseInt(el.dataset.idx));
    });
  });
}

async function selectDropdownItem(idx) {
  if (idx < 0 || idx >= state.dropdownItems.length) return;
  const f = state.dropdownItems[idx];
  if (f.isGoto) {
    closeCmdBar(false);
    try {
      let perm = await f.handle.queryPermission({ mode: 'read' });
      if (perm !== 'granted') perm = await f.handle.requestPermission({ mode: 'read' });
      if (perm === 'granted') {
        state.dirHandle = f.handle;
        setActiveRoot(state.dirHandle.name);
        await saveHandle(state.dirHandle);
        const ctx = await getTopChildren(state.dirHandle);
        await saveHistory(state.dirHandle, ctx);
        await scanAndRender();
        await restoreRootState();
      }
    } catch (e) { showStatus('Cannot access folder'); }
    return;
  }
  // Restore collapsed state before expanding only the needed path
  if (state.savedCollapsed) {
    state.collapsed.clear();
    state.savedCollapsed.forEach(p => state.collapsed.add(p));
    state.savedCollapsed = null;
    layout();
  }
  closeCmdBar(false);
  const fileName = f.isNode ? 'CLAUDE.md' : f.name;
  const content = await readMdFile(f.path, fileName);
  if (content !== null) {
    state.selectedNodePath = f.path;
    state.selectedFileName = fileName;
    ccmdTitle.textContent = f.path + '/' + fileName;
    ccmdBody.innerHTML = renderMarkdown(content);
    ccmdPanel.style.display = 'flex';
    jumpPush(f.path, fileName);
    saveMdv();
    centerOnNode(f.path);
    updateToolbar();
  }
}

function openCmdBar() {
  state.savedCam = { camX: state.camX, camY: state.camY, zoom: state.zoom };
  state.savedCollapsed = new Set(state.collapsed);
  cmdBar.style.display = 'block';
  cmdInput.value = '';
  cmdShadow.innerHTML = '<span class="typed"></span><span class="ghost">find</span>';
  cmdDropdown.style.display = 'none';
  state.dropdownIdx = -1;
  state.dropdownItems = [];
  cmdInput.focus();
  state.cmdBarOpen = true;
}

function closeCmdBar(restoreView) {
  if (state.closingCmdBar) return;
  state.closingCmdBar = true;
  cmdBar.style.display = 'none';
  cmdShadow.innerHTML = '';
  cmdDropdown.style.display = 'none';
  state.dropdownIdx = -1;
  state.dropdownItems = [];
  document.getElementById('cmd-wrap').classList.remove('has-dropdown');
  cmdInput.blur();
  state.cmdBarOpen = false;
  if (restoreView && state.savedCam) {
    state.camX = state.savedCam.camX; state.camY = state.savedCam.camY; state.zoom = state.savedCam.zoom;
    if (state.savedCollapsed) {
      state.collapsed.clear();
      state.savedCollapsed.forEach(p => state.collapsed.add(p));
      layout();
    }
    draw();
    saveView();
  }
  state.savedCam = null;
  state.savedCollapsed = null;
  state.closingCmdBar = false;
}

// --- Event listeners ---

cmdInput.addEventListener('blur', () => { closeCmdBar(true); });
cmdInput.addEventListener('input', () => { updateGhost(); updateDropdown(); });

// Fail-safe: command palette must always be toggleable
document.addEventListener('keydown', e => {
  if (e.key === ':' && !state.cmdBarOpen && document.activeElement === document.body) {
    e.preventDefault();
    openCmdBar();
  }
}, true);

cmdInput.addEventListener('keydown', e => {
  // Arrow keys for dropdown navigation
  if (state.dropdownItems.length > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    if (e.key === 'ArrowDown') state.dropdownIdx = Math.min(state.dropdownIdx + 1, state.dropdownItems.length - 1);
    else state.dropdownIdx = Math.max(state.dropdownIdx - 1, 0);
    cmdDropdown.querySelectorAll('.cmd-item').forEach((el, i) => {
      el.classList.toggle('active', i === state.dropdownIdx);
    });
    scrollDropdownToActive();
    if (state.dropdownIdx >= 0) centerOnNode(state.dropdownItems[state.dropdownIdx].path);
    return;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    if (state.dropdownItems.length > 0) {
      if (state.dropdownIdx < 0) state.dropdownIdx = 0;
      const f = state.dropdownItems[state.dropdownIdx];
      if (f.isNode) {
        cmdInput.value = 'find ' + f.name;
      } else {
        const lastSlash = f.path.lastIndexOf('/');
        const nodeName = lastSlash >= 0 ? f.path.slice(lastSlash + 1) : f.path;
        cmdInput.value = 'find ' + nodeName;
      }
      state.dropdownIdx = -1;
      updateGhost();
      updateDropdown();
      return;
    }
    // Tab-complete commands
    const val = cmdInput.value.trim().toLowerCase();
    if (state.tabMatches.length === 0 || state.tabMatches._query !== val) {
      state.tabMatches = cmdList.filter(c => c.startsWith(val) && c !== val);
      state.tabMatches._query = val;
      state.tabIdx = -1;
    }
    if (state.tabMatches.length === 0) return;
    state.tabIdx = (state.tabIdx + 1) % state.tabMatches.length;
    cmdInput.value = state.tabMatches[state.tabIdx];
    updateGhost();
    updateDropdown();
    return;
  }
  state.tabMatches = []; state.tabIdx = -1;
  if (e.key === 'Escape') { closeCmdBar(true); e.stopPropagation(); return; }
  if (e.key === 'Enter') {
    if (state.dropdownItems.length > 0) {
      selectDropdownItem(state.dropdownIdx < 0 ? 0 : state.dropdownIdx);
      e.stopPropagation();
      return;
    }
    const cmd = cmdInput.value.trim().toLowerCase();
    if (cmd === 'clear') {
      closeCmdBar(false);
      const root = state.dirHandle ? state.dirHandle.name : 'current root';
      if (!confirm('Clear all saved state for "' + root + '" and reload?')) return;
      Object.keys(localStorage).filter(k => k.startsWith('hub-tree-')).forEach(k => localStorage.removeItem(k));
      sessionStorage.removeItem(SESSION_ROOT_KEY);
      state.treeData = null;
      state.dirHandle = null;
      state.activeRoot = '';
      state.nodes.length = 0;
      state.allNodes.length = 0;
      state.collapsed.clear();
      state.pinnedCollapsed.clear();
      state.focusedPath = null;
      state.selectedNodePath = null;
      state.selectedFileName = null;
      state.jumpList = []; state.jumpIdx = -1;
      state.camX = 0; state.camY = 0; state.zoom = 1;
      ccmdPanel.style.display = 'none';
      promptEl.style.display = '';
      canvasCtx.clearRect(0, 0, state.W, state.H);
      showStatus('Cleared');
      return;
    }
    closeCmdBar(true);
    if (cmd === 'manual' || cmd === 'man' || cmd === 'help') {
      helpPanel.style.display = helpPanel.style.display === 'block' ? 'none' : 'block';
      hintEl.style.display = helpPanel.style.display === 'block' ? 'none' : 'block';
    } else if (cmd === 'open') {
      pickAndScan();
    } else if (cmd === 'palette') {
      // openColorPicker is in colorpicker.js, dispatch custom event
      document.dispatchEvent(new CustomEvent('open-color-picker'));
    } else if (cmd === 'find' || cmd === '' || cmd === 'goto') {
      // no query — do nothing
    } else if (cmd.startsWith('goto ')) {
      showStatus('No matching root');
    } else if (cmd.startsWith('find ')) {
      showStatus('No results');
    } else if (cmd) {
      showStatus('Unknown command: ' + cmd);
    }
    e.stopPropagation();
    return;
  }
});

// --- Global keyboard shortcuts ---

document.addEventListener('keydown', e => {
  // Color picker escape handled in colorpicker.js
  if (document.getElementById('color-picker').style.display === 'block') {
    return;
  }
  if (state.cmdBarOpen) return;
  if (e.key === 'Escape') {
    ctxMenu.style.display = 'none';
    return;
  }
  if (e.key === 'o' && e.ctrlKey && ccmdPanel.style.display === 'flex') {
    e.preventDefault();
    if (state.jumpIdx > 0) {
      state.jumpIdx--;
      saveJumpList();
      jumpTo(state.jumpList[state.jumpIdx]);
      showStatus('Jump ' + (state.jumpIdx + 1) + '/' + state.jumpList.length);
    }
    return;
  }
  if (e.key === 'i' && e.ctrlKey && ccmdPanel.style.display === 'flex') {
    e.preventDefault();
    if (state.jumpIdx < state.jumpList.length - 1) {
      state.jumpIdx++;
      saveJumpList();
      jumpTo(state.jumpList[state.jumpIdx]);
      showStatus('Jump ' + (state.jumpIdx + 1) + '/' + state.jumpList.length);
    }
    return;
  }
  if (e.key === ':') {
    e.preventDefault();
    openCmdBar();
    return;
  }
  if (e.key === 'f' && !e.ctrlKey) {
    e.preventDefault();
    openCmdBar();
    cmdInput.value = 'find ';
    updateGhost();
    return;
  }
  const panStep = 60;
  if (e.key === 'h') { state.camX += panStep / state.zoom; draw(); saveView(); return; }
  if (e.key === 'j') { state.camY -= panStep / state.zoom; draw(); saveView(); return; }
  if (e.key === 'k') { state.camY += panStep / state.zoom; draw(); saveView(); return; }
  if (e.key === 'l') { state.camX -= panStep / state.zoom; draw(); saveView(); return; }
  if (e.key === 'i' && !e.ctrlKey) { state.zoom = Math.min(10, state.zoom * 1.15); draw(); saveView(); return; }
  if (e.key === 'o' && !e.ctrlKey) { state.zoom = Math.max(0.2, state.zoom / 1.15); draw(); saveView(); return; }
  if (e.key === 'd') {
    if (ccmdPanel.style.display === 'flex') {
      ccmdPanel.style.display = 'none';
      draw();
    } else {
      try {
        const s = JSON.parse(localStorage.getItem(nsKey('hub-tree-mdv')));
        if (!s || !s.viewPath || !s.viewFile) return;
        if (state.dirHandle) {
          (async () => {
            const content = await readMdFile(s.viewPath, s.viewFile);
            if (content !== null) {
              state.selectedNodePath = s.viewPath;
              state.selectedFileName = s.viewFile;
              ccmdTitle.textContent = s.viewPath + '/' + s.viewFile;
              ccmdBody.innerHTML = renderMarkdown(content);
              ccmdPanel.style.display = 'flex';
              draw();
            }
          })();
        }
      } catch (e) {}
    }
    return;
  }
  if (e.key >= '1' && e.key <= '7') {
    const level = parseInt(e.key);
    state.collapsed.clear();
    state.nodes.forEach((n, i) => {
      if (!n.isLeaf && n.depth >= level) state.collapsed.add(n.path);
    });
    layout();
    draw();
    showStatus('Level ' + level);
  }
  if ((e.key === '+' || e.key === '=') && ccmdPanel.style.display === 'flex') {
    state.ccmdFontSize = Math.min(24, state.ccmdFontSize + 1);
    ccmdPanel.style.fontSize = state.ccmdFontSize + 'px';
    saveMdv();
    updateToolbar();
    return;
  }
  if (e.key === '-' && ccmdPanel.style.display === 'flex') {
    state.ccmdFontSize = Math.max(8, state.ccmdFontSize - 1);
    ccmdPanel.style.fontSize = state.ccmdFontSize + 'px';
    saveMdv();
    updateToolbar();
    return;
  }
  if (e.key === 'r') { reloadCcmd(); }
  if (e.key === 'R') { rescan(); }
  if (e.key === 'y') {
    const p = state.hoveredPath || state.selectedNodePath;
    if (p) { navigator.clipboard.writeText(p).then(() => showStatus('Copied: ' + p)); }
  }
  if (e.key === 'H' && ccmdPanel.style.display === 'flex') {
    state.panelSide = 'left';
    ccmdPanel.style.left = '0';
    ccmdPanel.style.right = 'auto';
    ccmdPanel.style.borderRight = '1px solid #30363d';
    ccmdPanel.style.borderLeft = 'none';
    ccmdDrag.style.right = '-4px';
    ccmdDrag.style.left = 'auto';
    helpPanel.style.left = 'auto';
    helpPanel.style.right = '20px';
    hintEl.style.left = 'auto';
    hintEl.style.right = '16px';
    saveMdv();
  }
  if (e.key === 'L' && ccmdPanel.style.display === 'flex') {
    state.panelSide = 'right';
    ccmdPanel.style.right = '0';
    ccmdPanel.style.left = 'auto';
    ccmdPanel.style.borderLeft = '1px solid #30363d';
    ccmdPanel.style.borderRight = 'none';
    ccmdDrag.style.left = '-4px';
    ccmdDrag.style.right = 'auto';
    helpPanel.style.right = 'auto';
    helpPanel.style.left = '20px';
    hintEl.style.right = 'auto';
    hintEl.style.left = '16px';
    saveMdv();
  }
  if (e.key === '?') {
    const show = helpPanel.style.display === 'none' || !helpPanel.style.display;
    if (show) {
      document.getElementById('storageInfo').textContent = 'localStorage: ' + getStorageInfo();
      document.getElementById('help-root').textContent = state.dirHandle ? state.dirHandle.name : '(none)';
    }
    helpPanel.style.display = show ? 'block' : 'none';
    hintEl.style.display = show ? 'none' : 'block';
  }
});
