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
- Side panel Markdown viewer with resizing, font scaling, and left/right positioning
- Command palette (`:`) with tab auto-completion, ghost text, and file finder
- Find files by node name (`find hub`) or browse children (`find hub/`)
- Multi-root support: open multiple roots in separate tabs, each with independent state
- Root history (up to 5 recent roots) with quick switch via `goto` command
- Jump list navigation (Ctrl+O / Ctrl+I) across viewed files
- Vim-style navigation (h/j/k/l to pan, i/o to zoom)
- Expand/collapse subtrees by depth level (1-7) or per-node (middle-click)
- All view and panel settings persisted per-root in localStorage across sessions

## Usage

1. Open `index.html` in a modern browser (Chrome/Edge recommended)
2. Click **Select Root** to select a project directory (or pick from recent history)
3. Navigate the tree with mouse or keyboard; press `?` for the full shortcut list

## Shortcuts

### Mouse

| Key | Action |
|-----|--------|
| drag | Pan canvas |
| left-click | Node → view CLAUDE.md |
| mid-dblclick | Reset view |
| middle-click | Node → expand / collapse |
| right-click | Node → list .md files |
| right-click | Viewer → reload file |
| scroll | Zoom |

### Navigation

| Key | Action |
|-----|--------|
| 1-7 | Expand to level N |
| h/j/k/l | Move left / down / up / right |
| i/o | Zoom in / out |

### Viewer

| Key | Action |
|-----|--------|
| +/- | Font size |
| Ctrl+O/I | Jump back / forward |
| H/L | Move to left / right |
| d | Toggle viewer |
| r | Reload file |

### Other

| Key | Action |
|-----|--------|
| : | Command bar |
| f | Find (command bar with `find `) |
| ? | Toggle shortcut help |
| R | Rescan folder |

### Commands

| Command | Action |
|---------|--------|
| find \<query\> | Search nodes and .md files |
| goto \<query\> | Switch to a different root from history |
| open | Open a new root folder |
| clear | Reset current root and return to selection |
| help / man | Toggle shortcut help |
