# agents-watch

Cursor IDE'de çalışan AI ajanlarını gerçek zamanlı izleyen dashboard. Hook'lar aracılığıyla event'leri SQLite'a yazar, DB'den outbox pattern ile okur, ReactFlow canvas (parent-child tree) + inspector + replay sunar.

## Komutlar

| Komut | Açıklama |
|-------|----------|
| `npm run dev` | Vite (5173) + server (4317) paralel başlatır |
| `npm run dev:web` | Sadece Vite frontend |
| `npm run dev:server` | Sadece `tsx watch server/index.ts` |
| `npm run test` | Tüm testleri tek seferde çalıştırır (`vitest run`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npx vitest run src/shared/workflowReducer.test.ts` | Tek test dosyası |

Doğrulama sırası: `npm run typecheck && npm run test`

## Mimari

```
Cursor plugin (cursor-plugin/hooks/ingest.cjs) ──(TCP/JSONL)──► server/index.ts (port 4318)
  (stdin → flatten → {appName, event} → buffer.jsonl → TCP)

                                                              │
                                                        INSERT raw_events
                                                        eventProcessor
                                                              │
                                                        SSE + API (port 4317)
                                                              │
                                                              ▼
                                                        React SPA (Vite, port 5173)
```

- **Cursor Plugin** (`cursor-plugin/`): Cursor plugin olarak dağıtılır, `~/.cursor/plugins/local/`'a symlink ile bağlanır. `hooks/hooks.json` 21 hook event'ini `ingest.cjs`'e yönlendirir. `ingest.cjs` stdin'den JSON okur, alanları düzleştirir, `.buffer.jsonl`'a yazar, ardından TCP/JSONL ile server'a (port 4318) göndermeye çalışır. Server kapalıysa buffer'da birikir, sonraki başarılı bağlantıda flush edilir. Her zaman exit 0 (fail-open). DB yok, HTTP yok, sadece net + fs.
- **Server**: Express yok, built-in `http`. TCP ingest listener (port 4318) ile `{appName, event}` JSONL satırlarını okur, `raw_events` + `runs` + `agents` tablolarına `workspace_root` ile yazar. Geriye dönük uyumluluk için `/api/ingest` POST endpoint'i korunur. SSE ve API (port 4317) DB'den okur.
- **Event Filter**: `server/eventFilter.ts` — heavy field'ları (`content`, `output`, `tool_output`, `text`, `edits` vb.) SSE/snapshot'ta `[heavy]` placeholder ile değiştirir. Full data sadece `GET /api/events/:id` endpoint'inden lazy load edilir. ~%98 bandwidth azalması.
- **Database**: `better-sqlite3` ile 7 tablo (`runs`, `agents`, `tool_calls`, `agent_chips`, `raw_events`, `sessions`, `server_state`). 5 kritik indeks: `agents(run_id, status)`, `agents(conversation_id)`, `tool_calls(agent_id, status)`, `raw_events(conversation_id)`, `raw_events(workspace_root)`. `currentRunId` server restart'ta `server_state`'ten recover edilir. `raw_events.run_id` her event işlendikten sonra populate edilir (outbox pattern). `raw_events.workspace_root` proje bazlı ayrım için kullanılır. `runs` ve `agents` tablolarında da `workspace_root` bulunur.
- **Shared**: `src/shared/parseLogLine.ts` ve `server/logFile.ts` artık aktif değil, sadece utility olarak korunuyor.
- **Reducer**: `src/shared/workflowReducer.ts` Redux tarzı pure reducer. `applyWorkflowEvent(state, event) → newState`. Replay için: `events.slice(0, n).reduce(applyWorkflowEvent, init)`.
- **Conversation binding**: Cursor `subagent_start` event'i `conversation_id` içermez. Reducer ve eventProcessor FIFO kuyruğu ile ajanları ilk gelen bilinmeyen conversation'a bağlar.
- **Canvas UI**: `AgentCanvas.tsx` ReactFlow ile dagre otomatik layout kullanır. Ajanlar tree şeklinde (parent-child) düzenlenir, status renk kodlu border + badge ile gösterilir. Edge'ler animated (child running durumunda) veya statik arrow olarak çizilir. MiniMap + Controls + fitView ile gezinme.

## Dizin Yapısı

| Dizin | Sorumluluk |
|-------|------------|
| `server/` | Backend: HTTP server, database, eventProcessor, hookMapper, setupHooks |
| `src/shared/` | Ortak: types, parser, reducer, hookTypes |
| `src/components/` | React: AgentCanvas (ReactFlow), AgentNode, InspectorPanel, EventFeed, ReplayControls, SessionSidebar, StatusLight, ResourceChips |
| `src/hooks/` | React hooks: useWorkflowStream (SSE), useReplay (DVR), useSessions |
| `cursor-plugin/` | Cursor plugin paketi (manifest, hooks, SQLite DB) |
| `hooks/` | Cursor hook script'leri (kütüphane ile dağıtılır) |
| `src/` | Root: `App.tsx`, `main.tsx`, `setupTests.ts` (vitest setup, ResizeObserver stub) |
| `docs/plans/` | Planlar ve tasarım dokümanları |
| `.opencode/plans/` | OpenCode plan dosyaları |

## Hook Sistemi

Proje bir **kütüphane/araçtır** — `.cursor/hooks.json` kendi reposunda değil, kullanıcının projesinde olmalıdır.

- `cursor-plugin/hooks/ingest.cjs`: 21 Cursor hook'unu tek bir script'le yakalar. stdin'den JSON okur, alanları düzleştirir, `.buffer.jsonl`'a yazar, ardından TCP/JSONL ile server'a (port 4318) göndermeye çalışır. Server kapalıysa buffer'da birikir, sonraki başarılı bağlantıda flush edilir. Her zaman exit 0 (fail-open). DB yok, HTTP yok, sadece net + fs.
- `hooks/generic-hook.js`: Legacy alternatif — HTTP POST ile `/api/ingest`'e event gönderir. Sadece geriye dönük uyumluluk için korunuyor.
- `server/setupHooks.ts`: Server başlarken kullanıcının proje kökünde `.cursor/hooks.json` yoksa otomatik oluşturur, `cursor-plugin/hooks/ingest.cjs`'i referans alır. `PROJECT_ROOT` env var'ı veya `process.cwd()` ile proje kökünü bulur.
- `cursor-plugin/hooks/hooks.json`: Plugin manifest'i ile otomatik keşfedilen hook registration. Plugin `~/.cursor/plugins/local/agents-watch/`'a kurulduğunda, tüm 21 hook event'i otomatik olarak tanınır (proje bazlı `.cursor/hooks.json` gerekmez).
- `server/hookMapper.ts`: Hook payload'larını LogEvent formatına dönüştürür. `preToolUse → tool_start`, `postToolUse → tool_done`, `subagentStart → subagent_start`, `sessionEnd → session_end`, diğerleri → `hook_event`.
- `src/shared/hookTypes.ts`: 21 hook için label, kategori (agent/tab/lifecycle) tanımları.
- Reducer'da `hook_event` case'i: `subagentStop` ve `stop` hook'ları ajan durumunu günceller, diğerleri `hookEvents[]` dizisinde birikir.
- EventProcessor'da `hook_event` case'i: `subagentStop` ve `stop` hook'ları SQLite'da ajan durumunu ve run completion'ı günceller.

## Event Tipleri ve Hook Mapping

| Hook | → eventType | Açıklama |
|------|------------|----------|
| `preToolUse` | `tool_start` | Tool başlangıcı |
| `postToolUse` | `tool_done` (ok=true) | Tool tamamlandı |
| `postToolUseFailure` | `tool_done` (ok=false) | Tool başarısız |
| `subagentStart` | `subagent_start` | Subagent başladı |
| `sessionStart` | `hook_event` | Oturum başladı (sessions tablosuna yazılır) |
| `sessionEnd` | `session_end` | Oturum bitti (sessions tablosu güncellenir, agent completed) |
| `subagentStop` | `hook_event` | Subagent durdu |
| `stop` | `hook_event` | Agent durdu |
| diğer 13 hook | `hook_event` | Genel hook event'leri |

## SQLite Schema

7 tablo:

| Tablo | Amaç |
|-------|------|
| `runs` | Agent çalıştırma grupları (Task başlangıcı → tamamlanma) |
| `agents` | Agent durumu, hiyerarşi |
| `tool_calls` | Tool çağrıları ve sonuçları |
| `agent_chips` | Skills, rules, decisions |
| `raw_events` | Tüm event'lerin ham kaydı (outbox) |
| `sessions` | Cursor IDE oturumları (sessionStart → sessionEnd) |
| `server_state` | Key-value persistence (cursor offset vb.) |

## Önemli Detaylar

- Proje `"type": "module"` (ESM). `__dirname` yok, `import.meta.url` + `fileURLToPath` kullan.
- `VITE_HIDE_ERRORS=true` env var'ı hatalı ajan görsellerini gizler.
- `PROJECT_ROOT` env var'ı ile hook'ların kurulacağı proje kökü belirlenir. Yoksa `process.cwd()`.
- `AGENTS_WATCH_PORT` env var'ı generic-hook.js'in POST edeceği port'u belirler. Varsayılan 4317.
- `DB_PATH` env var'ı ile SQLite dosya yolu belirlenir. Yoksa `<agents-watch>/.db/agents-watch.db`.
- `raw_events.workspace_root` her event'te tutulur; `workspace_roots[0]`'ın basename'inden alınır, proje bazlı sorgulama için.
- 112 test, 15 test dosyası. Hepsi `vitest` ile çalışır, jsdom environment kullanır.
- CSS: Pure CSS, `src/styles.css`. BEM benzeri isimlendirme (`block__element--modifier`).
- Test setup: `src/setupTests.ts` `ResizeObserver` stub sağlar (ReactFlow jsdom'da çalışsın diye). `vite.config.ts`'te `setupFiles` olarak tanımlı.

## Geliştirme Sonrası AGENTS.md Güncelleme

**HER SESSION SONUNDA** — commit öncesi bu checklist'i uygula:

- [ ] Yeni bir script/komut eklendiyse → Komutlar tablosuna ekle
- [ ] Yeni bir dizin/modül eklendiyse → Dizin Yapısı'na ekle
- [ ] Yeni bir endpoint eklendiyse → Mimari bölümüne ekle
- [ ] Yeni env var eklendiyse → Önemli Detaylar'a ekle
- [ ] Yeni bir tablo/index eklendiyse → SQLite Schema'ya ekle
- [ ] Yeni bir hook/event mapping eklendiyse → Event Tipleri tablosuna ekle
- [ ] `npm run typecheck && npm run test` geçti mi, test sayısı güncel mi
- [ ] Son olarak `/check-docs` komutunu çalıştır

İhlal: Source dosya değişti ama AGENTS.md güncellenmediyse commit yapma.
