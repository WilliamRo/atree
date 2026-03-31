// core.js — shared state, constants, IndexedDB, localStorage utils, DOM refs, helpers

// --- Constants ---
export const SESSION_ROOT_KEY = 'hub-tree-active-root';
export const DB_NAME = 'hub-tree-db';
export const DB_STORE = 'handles';
export const DB_HISTORY_STORE = 'history';
export const DB_HISTORY_KEY = 'roots';
export const MAX_HISTORY = 5;
export const SKIP = new Set(['.git', '.idea', '.agents', '.claude', '__pycache__', 'node_modules', '.pytest_cache']);

// --- DOM refs ---
export const canvas = document.getElementById('c');
export const canvasCtx = canvas.getContext('2d');
export const tooltip = document.getElementById('tooltip');
export const promptEl = document.getElementById('prompt');
export const statusEl = document.getElementById('status');
export const ccmdPanel = document.getElementById('ccmd-panel');
export const ccmdTitle = document.getElementById('ccmd-title');
export const ccmdBody = document.getElementById('ccmd-body');
export const ctxMenu = document.getElementById('ctx-menu');
export const helpPanel = document.getElementById('help');
export const hintEl = document.getElementById('hint');
export const ccmdDrag = document.getElementById('ccmd-drag');

// --- Shared mutable state ---
export const state = {
  activeRoot: sessionStorage.getItem(SESSION_ROOT_KEY) || '',
  W: 0,
  H: 0,
  treeData: null,
  dirHandle: null,
  selectedNodePath: null,
  selectedFileName: null,
  ccmdFontSize: 12,
  panelSide: 'left',
  jumpList: [],
  jumpIdx: -1,
  camX: 0,
  camY: 0,
  zoom: 1,
  dragging: false,
  dragStartX: 0,
  dragStartY: 0,
  camStartX: 0,
  camStartY: 0,
  hoveredPath: null,
  nodes: [],
  allNodes: [],
  collapsed: new Set(),
  layerSpacing: 140,
  pinnedCollapsed: new Set(),
  focusedPath: null,
  clickStartX: 0,
  clickStartY: 0,
  lastMidClick: 0,
  ccmdDragging: false,
  // Command bar state
  cmdBarOpen: false,
  dropdownIdx: -1,
  dropdownItems: [],
  savedCam: null,
  savedCollapsed: null,
  closingCmdBar: false,
  gotoMode: false,
  tabIdx: -1,
  tabMatches: [],
  // Address bar state
  addrActiveId: null,
  addrCloseTime: 0,
};

// --- Namespace key helper ---
export function nsKey(base) {
  return state.activeRoot ? base + ':' + state.activeRoot : base;
}

export function setActiveRoot(name) {
  state.activeRoot = name;
  sessionStorage.setItem(SESSION_ROOT_KEY, name);
}

// --- IndexedDB ---
export function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      if (!db.objectStoreNames.contains(DB_HISTORY_STORE)) db.createObjectStore(DB_HISTORY_STORE);
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

export async function saveHandle(handle) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(handle, 'dirHandle:' + handle.name);
      tx.oncomplete = resolve;
      tx.onerror = e => reject(e.target.error);
    });
  } catch (e) {}
}

export async function loadHandle(name) {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get('dirHandle:' + name);
      req.onsuccess = e => resolve(e.target.result || null);
      req.onerror = e => reject(e.target.error);
    });
  } catch (e) { return null; }
}

export async function getTopChildren(handle) {
  const names = [];
  try {
    for await (const [name, entry] of handle.entries()) {
      if (entry.kind === 'directory' && !name.startsWith('.')) names.push(name + '/');
      if (names.length >= 5) break;
    }
  } catch (e) {}
  names.sort();
  return names.slice(0, 5).join(', ');
}

export async function saveHistory(handle, context) {
  try {
    const db = await openDB();
    const history = await loadHistory();
    const existing = history.findIndex(h => h.name === handle.name);
    if (existing >= 0) history.splice(existing, 1);
    history.unshift({ handle, name: handle.name, context });
    while (history.length > MAX_HISTORY) history.pop();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_HISTORY_STORE, 'readwrite');
      tx.objectStore(DB_HISTORY_STORE).put(history, DB_HISTORY_KEY);
      tx.oncomplete = resolve;
      tx.onerror = e => reject(e.target.error);
    });
  } catch (e) {}
}

export async function loadHistory() {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_HISTORY_STORE, 'readonly');
      const req = tx.objectStore(DB_HISTORY_STORE).get(DB_HISTORY_KEY);
      req.onsuccess = e => resolve(e.target.result || []);
      req.onerror = e => reject(e.target.error);
    });
  } catch (e) { return []; }
}

// --- File I/O ---
export async function getDirHandle(nodePath) {
  if (!state.dirHandle) return null;
  const parts = nodePath.split('/');
  let handle = state.dirHandle;
  try {
    for (let i = 1; i < parts.length; i++) {
      handle = await handle.getDirectoryHandle(parts[i]);
    }
    return handle;
  } catch (e) { return null; }
}

export async function listMdFiles(nodePath) {
  const handle = await getDirHandle(nodePath);
  if (!handle) return [];
  const files = [];
  for await (const entry of handle.values()) {
    if (entry.kind === 'file' && entry.name.endsWith('.md')) {
      files.push(entry.name);
    }
  }
  return files.sort();
}

export async function readMdFile(nodePath, filename) {
  const handle = await getDirHandle(nodePath);
  if (!handle) return null;
  try {
    const fileHandle = await handle.getFileHandle(filename);
    const file = await fileHandle.getFile();
    return await file.text();
  } catch (e) { return null; }
}

// --- Utility functions ---
export function showStatus(msg) {
  statusEl.textContent = msg;
  statusEl.style.opacity = '1';
  setTimeout(() => { statusEl.style.opacity = '0'; }, 2000);
}

export function getStorageInfo() {
  let total = 0;
  for (let k in localStorage) {
    if (localStorage.hasOwnProperty(k)) {
      total += localStorage[k].length * 2; // UTF-16
    }
  }
  const kb = (total / 1024).toFixed(1);
  const mb = (total / (1024 * 1024)).toFixed(2);
  return total > 1024 * 1024 ? `${mb} MB / 5 MB` : `${kb} KB / 5 MB`;
}

export function resize() {
  state.W = canvas.width = window.innerWidth;
  state.H = canvas.height = window.innerHeight;
}

// --- Init ---
resize();
window.addEventListener('resize', () => { resize(); /* draw called from tree.js */ });
