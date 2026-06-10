# Cursor Plugin Implementation Plan

> **Goal:** Build a Cursor plugin inside agents-watch that collects agent activity via hooks and writes directly to SQLite, decoupling event ingestion from the HTTP server.

**Architecture:** Hook scripts (`ingest.cjs`) run as Cursor child processes, parse stdin JSON, and INSERT directly into a shared SQLite DB (`cursor-plugin/.db/agents-watch.db`). The agents-watch server polls raw_events for unprocessed rows (outbox pattern), processes them via eventProcessor, and serves the dashboard via SSE. No HTTP ingestion needed.

**Tech Stack:** Node.js (CJS hooks), better-sqlite3, Cursor Plugin API, ESM server

---

## Task 1: Plugin Directory Structure

**Files:**
- Create: `cursor-plugin/.cursor-plugin/plugin.json`
- Create: `cursor-plugin/hooks/hooks.json`
- Create: `cursor-plugin/.db/.gitkeep`

**Step 1:** Create `plugin.json` manifest

**Step 2:** Create hooks.json registering all 21 events → `node hooks/ingest.cjs`

**Step 3:** Ensure .db/ directory exists

## Task 2: ingest.cjs Hook Script

**Files:**
- Create: `cursor-plugin/hooks/ingest.cjs`

**Step 1:** Parse stdin JSON from Cursor hook

**Step 2:** Map hook_event_name to event_type (same mapping as hookMapper.ts)

**Step 3:** Flatten fields, preserve raw JSON

**Step 4:** Insert into raw_events via better-sqlite3 (DB at `../.db/agents-watch.db`)

**Step 5:** Return `{permission: "allow"}` for preToolUse, `{}` for others, exit 0

## Task 3: Server Database Updates

**Files:**
- Modify: `server/database.ts`

**Step 1:** Add `workspace_root` column to raw_events

**Step 2:** Change default DB path to cursor-plugin/.db/agents-watch.db

**Step 3:** Add index on workspace_root

## Task 4: Outbox Polling in Server

**Files:**
- Modify: `server/index.ts`

**Step 1:** Add `pollUnprocessedEvents()` that selects raw_events WHERE run_id IS NULL

**Step 2:** Run it on a setInterval (1s, same as SSE poll)

**Step 3:** processEvent each unprocessed row and update run_id

## Task 5: Setup Hooks Update

**Files:**
- Modify: `server/setupHooks.ts`

**Step 1:** Update hook command path to reference cursor-plugin/hooks/ingest.cjs

**Step 2:** Create .db directory on startup

## Task 6: Verification & Documentation

**Files:**
- Modify: `AGENTS.md`

**Step 1:** Run `npm run typecheck && npm run test`

**Step 2:** Update AGENTS.md with new plugin structure
