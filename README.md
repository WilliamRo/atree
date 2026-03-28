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
- Command palette (`:`) with tab auto-completion and ghost text
- Jump list navigation (Ctrl+O / Ctrl+I) across viewed files
- Expand/collapse subtrees by depth level (1-7) or per-node (middle-click)
- All view and panel settings persisted in localStorage across sessions

## Usage

1. Open `index.html` in a modern browser (Chrome/Edge recommended)
2. Click **Open Folder** to select a project directory
3. Navigate the tree with mouse; press `?` for the full shortcut list

## Shortcuts

| Key | Action |
|-----|--------|
| scroll | Zoom |
| drag | Pan canvas |
| left-click | View node's CLAUDE.md |
| middle-click | Expand / collapse node |
| mid-dblclick | Reset view |
| right-click node | List .md files |
| d | Toggle viewer panel |
| 1-7 | Expand to depth N |
| +/- | Viewer font size |
| H / L | Viewer to left / right |
| Ctrl+O / Ctrl+I | Jump back / forward |
| : | Command palette |
| ? | Toggle shortcut help |
