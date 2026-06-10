# agents-watch

Cursor IDE'de çalışan AI ajanlarını gerçek zamanlı izleyen dashboard. Hook'lar aracılığıyla event'leri SQLite'a yazar, DB'den outbox pattern ile okur, kanban board + inspector + replay sunar.

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
Cursor hooks ──(POST /api/ingest)──► server/index.ts (Node http, port 4317)
                                        │
                                   hookMapper.ts → mapHookToLogEvent
                                        │
                                   INSERT raw_events → processEvent (SQLite)
                                        │
                                   SSE (/api/events) + /api/snapshot + /api/runs
                                        │
                                        ▼
                                   React SPA (Vite, port 5173)
                                   useWorkflowStream → reduceWorkflowEvents → UI
                                   useRuns → SessionSidebar
```

- **Server**: Express yok, built-in `http`. Hook event'leri `/api/ingest` POST endpoint'inden alır, `hookMapper.ts` ile LogEvent formatına dönüştürür, `raw_events` tablosuna yazar, `eventProcessor.ts` ile derived state'i günceller. SSE ve snapshot DB'den okur.
- **Event Filter**: `server/eventFilter.ts` — heavy field'ları (`content`, `output`, `tool_output`, `text`, `edits` vb.) SSE/snapshot'ta `[heavy]` placeholder ile değiştirir. Full data sadece `GET /api/events/:id` endpoint'inden lazy load edilir. ~%98 bandwidth azalması.
- **Hook Sistemi**: `hooks/generic-hook.js` 21 Cursor hook'unu yakalar, stdin'den JSON okur, alanları düzleştirir, `POST /api/ingest` ile server'a HTTP POST yapar. Her zaman exit 0 (fail-open).
- **Database**: `better-sqlite3` ile 7 tablo (`runs`, `agents`, `tool_calls`, `agent_chips`, `raw_events`, `sessions`, `server_state`). 3 kritik indeks: `agents(run_id, status)`, `agents(conversation_id)`, `tool_calls(agent_id, status)`. `currentRunId` server restart'ta `server_state`'ten recover edilir. `raw_events.run_id` her event işlendikten sonra populate edilir.
- **Shared**: `src/shared/parseLogLine.ts` ve `server/logFile.ts` artık aktif değil, sadece utility olarak korunuyor.
- **Reducer**: `src/shared/workflowReducer.ts` Redux tarzı pure reducer. `applyWorkflowEvent(state, event) → newState`. Replay için: `events.slice(0, n).reduce(applyWorkflowEvent, init)`.
- **Conversation binding**: Cursor `subagent_start` event'i `conversation_id` içermez. Reducer ve eventProcessor FIFO kuyruğu ile ajanları ilk gelen bilinmeyen conversation'a bağlar.

## Dizin Yapısı

| Dizin | Sorumluluk |
|-------|------------|
| `server/` | Backend: HTTP server, database, eventProcessor, hookMapper, setupHooks |
| `src/shared/` | Ortak: types, parser, reducer, hookTypes |
| `src/components/` | React: OfficeBoard, AgentCard, InspectorPanel, EventFeed, ReplayControls, SessionSidebar |
| `src/hooks/` | React hooks: useWorkflowStream (SSE), useReplay (DVR), useRuns |
| `hooks/` | Cursor hook script'leri (kütüphane ile dağıtılır) |
| `docs/plans/` | Planlar ve tasarım dokümanları |
| `.opencode/plans/` | OpenCode plan dosyaları |

## Hook Sistemi

Proje bir **kütüphane/araçtır** — `.cursor/hooks.json` kendi reposunda değil, kullanıcının projesinde olmalıdır.

- `hooks/generic-hook.js`: 21 Cursor hook'unu tek bir script'le yakalar. stdin'den JSON okur, alanları düzleştirir, `POST /api/ingest` ile server'a HTTP POST yapar. Her zaman exit 0 (fail-open).
- `server/setupHooks.ts`: Server başlarken kullanıcının proje kökünde `.cursor/hooks.json` yoksa otomatik oluşturur, hook script'i kopyalar. `PROJECT_ROOT` env var'ı veya `process.cwd()` ile proje kökünü bulur.
- `server/hookMapper.ts`: Hook payload'larını LogEvent formatına dönüştürür. `preToolUse → tool_start`, `postToolUse → tool_done`, `subagentStart → subagent_start`, diğerleri → `hook_event`.
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
| `sessionEnd` | `hook_event` | Oturum bitti (sessions tablosu güncellenir) |
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
- `DB_PATH` env var'ı ile SQLite dosya yolu belirlenir. Yoksa `./agents-watch.db`.
- `AGENTS_WATCH_PORT` env var'ı generic-hook.js'in POST edeceği port'u belirler. Varsayılan 4317.
- 106 test, 13 test dosyası. Hepsi `vitest` ile çalışır, jsdom environment kullanır.
- CSS: Pure CSS, `src/styles.css`. BEM benzeri isimlendirme (`block__element--modifier`).

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
