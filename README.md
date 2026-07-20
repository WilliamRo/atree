# ATree

Interactive tree visualizer for hierarchical folder structures, rendered on HTML5 Canvas. Designed for exploring project trees with inline Markdown viewing.

Live at [atree.top](https://atree.top).

## TL;DR

Visit [atree.top](https://atree.top), pick a root folder, and boom — your entire project tree is laid out in front of you with every `.md` file one click away.

## Why

When you work with AI coding agents, knowledge doesn't live in people's heads — it lives in `.md` files scattered across your repo: `CLAUDE.md` for instructions, `DESIGN.md` for architecture, `README.md` for context. These files form a hidden know-how structure that mirrors your folder hierarchy, and the agent's effectiveness depends on how well this structure is organized, maintained, and understood.

But file explorers show you a flat list. They don't reveal the shape of your knowledge tree or let you quickly audit what guidance exists at each level. ATree fills that gap: it renders the full hierarchy as a navigable radial tree and lets you read any Markdown file in place — so you can see the structure, spot the gaps, and keep the whole system coherent as it grows.

## Features

- Canvas-based radial tree layout with smooth zoom and pan
- Click any node to view its CLAUDE.md; right-click to browse all .md files
- Side panel Markdown viewer with resizing, font scaling, left/right positioning, and inline formatting for bold, italic, code, links, math, and images
- Inline images via `![alt](src)` (and plain links to image files): remote URLs load directly; local paths resolve against the `.md` file's own folder, or as a root-rooted `<root>/sub/.../pic.png` path — whichever exists on disk
- Collapsible panels: a `<details class="panel">` block renders as a foldable disclosure with its body Markdown rendered inside — for asides, proofs, and long-form detail; panels can nest
- Inline annotations: `\comment{...}` renders as a red note and `\muted{...}` as a muted gray span — handy for callouts or bilingual translations placed next to the source text
- Chrome-style tabs in the viewer: Ctrl+click a node / link / palette result to open in a new tab, click the `+` button for the root's CLAUDE.md as a homepage, switch with `,` / `.`, close with the tab's × or middle-click; Ctrl+O / Ctrl+I jump back/forward inside the active tab; picking a fresh root auto-opens its CLAUDE.md
- Cross-file Markdown links: any link of the form `[text](<root>/sub/.../file.md)` resolves within the active tree (the first segment is treated as a root marker)
- Command palette (`:`) with tab auto-completion, ghost text, and file finder
- Find files by full path (`find courses/bsp/`) or node name (`find hub`); search pierces collapsed subtrees
- Pin nodes as "collapse by default" via right-click; set a "current focus" with gold highlight
- Folder handle persisted in IndexedDB — file access survives browser refresh
- Multi-root support: open multiple roots in separate tabs, each with independent state
- Root history (up to 5 recent roots) with quick switch via `goto` command
- Jump list navigation (Ctrl+O / Ctrl+I) across viewed files
- Vim-style navigation (h/j/k/l to pan, i/o to zoom)
- Expand/collapse subtrees by depth level (1-7) or per-node (middle-click); collapsed nodes release angular space to neighbors
- All view and panel settings persisted per-root in localStorage across sessions

## Usage

1. Open `index.html` in a modern browser (Chrome/Edge recommended)
2. Click **Select Root** to select a project directory (or pick from recent history)
3. Navigate the tree with mouse or keyboard; press `?` for the full shortcut list

## Shortcuts

### Tree Viewer

| Key | Action |
|-----|--------|
| drag | Pan canvas |
| scroll | Zoom |
| left-click | Node → view CLAUDE.md / DESIGN.md |
| Ctrl+click | Node → open in new tab |
| middle-click | Node → expand / collapse |
| mid-dblclick | Reset view |
| right-click | Node → list .md files |
| right-click | Empty space → rescan tree |
| 1-7 | Expand to level N |
| h/j/k/l | Move left / down / up / right |
| i/o | Zoom in / out |

### Markdown Viewer

| Key | Action |
|-----|--------|
| right-click | Reload file |
| Ctrl+click | Link → open in new tab |
| middle-click | Tab → close |
| middle-click | Breadcrumb segment → open / toggle CLAUDE.md ↔ DESIGN.md |
| +/- | Font size |
| Ctrl+o/i | Jump back / forward (per tab) |
| ,/. | Switch tab left / right (wrap-around) |
| Ctrl+Enter | Open palette result in a new tab |
| + (tab strip) | Open root CLAUDE.md as a homepage in a new tab |
| H/L | Move viewer to left / right |
| d | Show / hide viewer |
| r | Reload file |

In edit mode (Edit button on the viewer), all global keyboard shortcuts are disabled so they don't collide with text input. Use the toolbar `+/-` buttons for font size while editing.

### Global

| Key | Action |
|-----|--------|
| : | Summon command palette |
| f | Find (command palette with `find `) |
| ? | Toggle help panel |
| y | Copy node path to clipboard |
| R | Rescan tree from root |

### Commands

| Command | Action |
|---------|--------|
| find \<query\> | Search by name or full path (e.g. `find courses/bsp/`) |
| goto \<query\> | Switch to a different root from history |
| open | Open a new root folder |
| clear | Reset current root and return to selection |
| help / man | Toggle shortcut help |
