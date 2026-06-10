# Missing Cursor Hooks in Activity Log

Cursor'un desteklediği ama `activity.log` dosyamızda bulunmayan hook'lar.

## Desteklenen Cursor Hook'ları

Kaynak: https://cursor.com/docs/hooks

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [{ "command": "..." }],
    "sessionEnd": [{ "command": "..." }],
    "preToolUse": [{ "command": "...", "matcher": "Shell|Read|Write" }],
    "postToolUse": [{ "command": "..." }],
    "subagentStart": [{ "command": "..." }],
    "subagentStop": [{ "command": "..." }],
    "beforeShellExecution": [{ "command": "..." }],
    "afterShellExecution": [{ "command": "..." }],
    "afterMCPExecution": [{ "command": "..." }],
    "afterFileEdit": [{ "command": "..." }],
    "preCompact": [{ "command": "...", "loop_limit": 10 }],
    "stop": [{ "command": "..." }],
    "beforeTabFileRead": [{ "command": "..." }],
    "afterTabFileEdit": [{ "command": "..." }],
    "workspaceOpen": [{ "command": "..." }]
  }
}
```

## Log'umuzdaki hook_event_name Değerleri

```
sessionStart
sessionEnd
preToolUse
postToolUse
postToolUseFailure
subagentStart
beforeShellExecution
afterShellExecution
beforeReadFile
afterFileEdit
```

## Log'umuzdaki Event Type'lar

```
tool_start
tool_done
subagent_start
skill_read
rule_read
decisions_read
file_read
file_edit
shell_start
shell_done
session_start
session_end
agent_update
```

## Eksik Hook'lar

| Hook | Etki | Neden Önemli? |
|------|------|---------------|
| `subagentStop` | Subagent durduğunda tetiklenir | Subagent'ın ne zaman bittiğini tam olarak bilmek için. Şu an `session_end` ile yetiniyoruz ama bu her zaman düşmeyebiliyor. |
| `afterMCPExecution` | MCP aracı çalıştıktan sonra | MCP tabanlı tool call'ları takip etmek için. |
| `preCompact` | Context compaction öncesi | Context'in ne zaman sıkıştırıldığını ve hangi bilgilerin kaybolduğunu görmek için. |
| `stop` | Agent durdurulduğunda | Kullanıcının agent'ı manuel durdurmasını yakalamak için. |
| `beforeTabFileRead` | Tab dosyası okumadan önce | Tab içeriği okumalarını izlemek için. |
| `afterTabFileEdit` | Tab dosyası düzenlendikten sonra | Tab içeriği düzenlemelerini izlemek için. |
| `workspaceOpen` | Workspace açıldığında | Yeni bir çalışma oturumunun başladığını algılamak için. |

## Notlar

- `beforeReadFile` Cursor hook'u değil, Cursor'un internal event'i. Hook listesinde yok ama log'a düşüyor.
- `skill_read`, `rule_read`, `decisions_read` event'leri de Cursor internal events — doğrudan hook değil.
- `postToolUseFailure` ayrı bir hook değil, `postToolUse`'un başarısız varyasyonu. Cursor otomatik olarak log'a düşürüyor.
- Eksik hook'ları kullanmak için `.cursor/hooks.json` dosyasına script eklemek gerekiyor. Örn:
  ```json
  {
    "version": 1,
    "hooks": {
      "subagentStop": [{ "command": "echo 'subagentStop | ...' >> activity.log" }],
      "afterMCPExecution": [{ "command": "echo 'afterMCPExecution | ...' >> activity.log" }]
    }
  }
  ```
