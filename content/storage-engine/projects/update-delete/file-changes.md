# File & Page Layout Changes

This page documents every new file added, every existing file modified, and any changes to on-disk page structures introduced in the update / delete / compaction phase.

---

## Page Layout Changes

### Table header page (Page 0) — `dead_tuple_count` field added

**File affected:** all `.dat` heap files

Previously, page 0 stored only `page_count` in bytes 0–4. This phase adds a second u32 field at bytes 4–8.

**New layout:**

```
Offset  Size  Field
──────  ────  ───────────────────
0       4 B   page_count        (u32, little-endian)
4       4 B   dead_tuple_count  (u32, little-endian)  ← NEW
8       …     reserved / zeroed
```

`dead_tuple_count` is incremented atomically on every soft-delete (DELETE and the old-version step of UPDATE) and reset to 0 after a successful compaction. The autovacuum scheduler reads this field to compute each table's compaction priority.

---

## New Files

### Backend

| File | Purpose |
|---|---|
| `src/backend/executor/delete.rs` | Full DELETE implementation: WHERE parsing, slot flagging, dead-tuple accounting, VM update, logging |
| `src/backend/executor/update.rs` | Full UPDATE implementation: scan matching tuples → soft-delete old version → reinsert new version |
| `src/backend/executor/api.rs` | Integration façade for the heap/FSM team — exposes `insert_raw_tuple`, `rebuild_table_fsm`, `update_page_free_space` |
| `src/backend/page/page_lock.rs` | RAII page-level write lock using a global `OnceLock<Mutex<PageLockRegistry>>` |
| `src/backend/log/operation_log.rs` | JSON-line operation logging for update, delete, and compaction |
| `src/backend/visibility_map/vm.rs` | Visibility Map: per-page all-visible tracking used by autovacuum to skip clean pages |
| `src/backend/instrumentation.rs` | Lock-free atomic counters for FSM and Heap operation telemetry (required by heap team) |
| `src/bin/benchmark_compare.rs` | Benchmark harness — RookDB vs PostgreSQL for UPDATE, DELETE, VACUUM, and VACUUM FULL |

### Tests

| File | Coverage |
|---|---|
| `code/tests/test_delete.rs` | 57 tests: soft-delete correctness, zero-match deletes, delete-all, WHERE edge cases, page-lock safety |
| `code/tests/test_update.rs` | 30 tests: condition matching, arithmetic SET, zero-match updates, RETURNING, page-lock behaviour |
| `code/tests/test_compaction.rs` | 10 tests: live-tuple preservation, lock held during rewrite, idempotency, post-compaction free space |
| `code/tests/test_page_lock.rs` | Timing tests: verifies a held `PageWriteLock` delays concurrent mutators by ≥ 4 500 ms |
| `code/tests/test_fsm_large.rs` | FSM correctness at scale after many inserts and compactions |

### Intermediate / Generated Files

Logs are created at runtime per-database and per-table:

```
database/logs/
└── <db_name>/
    └── <table_name>/
        ├── update.log
        ├── delete.log
        └── compaction.log
```

Each file is append-only. One JSON object per line:

```json
{
  "timestamp": "2026-04-20T12:34:56.789Z",
  "operation": "delete",
  "details": { "deleted_count": 1000, "condition_groups": 1 },
  "status": "success"
}
```

---

## Modified Files

### `src/backend/table/table_file.rs`

**Added functions:**

| Function | Change |
|---|---|
| `read_dead_tuple_count(file) → u32` | New — reads bytes 4–8 of page 0 |
| `write_dead_tuple_count(file, count)` | New — overwrites bytes 4–8 of page 0 |
| `increment_dead_tuple_count(file, delta)` | New — saturating-add to the stored counter |

**Added struct:** `TableHeader { page_count: u32, dead_tuple_count: u32 }` for typed header access.

---

### `src/backend/disk/disk_manager.rs`

Modified by the disk/heap team as part of the integration handshake. Exposes `update_header_page` and `read_header_page` used by `api.rs` when persisting `fsm_page_count` after a rebuild.

---

### `src/backend/heap/heap_manager.rs`

Modified by the heap team to support `HeapManager::open` and `HeapManager::insert_tuple`, which `insert_raw_tuple` in `api.rs` delegates to. Also integrates `FSM::build_from_heap` for FSM rebuild after compaction.

---

### `src/backend/executor/seq_scan.rs` — `show_tuples`

Updated to check the `SLOT_FLAG_DELETED` bit on each item-ID entry while scanning. Soft-deleted tuples are now completely invisible to `Show Tuples`.

```rust
// Before: all slots were shown
// After: skip any slot where flags & SLOT_FLAG_DELETED != 0
if item_flags & SLOT_FLAG_DELETED != 0 {
    continue;
}
```

---

### `src/backend/mod.rs`

Registered three new sub-modules:

```rust
pub mod visibility_map;
pub mod page;        // already existed; page_lock module added inside
pub mod heap {
    pub mod autovacuum;  // added
    // ...
}
pub mod log {
    pub mod operation_log;  // added
}
```

---

### `src/frontend/menu.rs`

Three new menu options added (options 9, 10, 11; Exit moved to 12):

```
9.  Delete Tuples
10. Update Tuples
11. Compact Table
12. Exit
```

---

### `src/frontend/data_cmd.rs`

Three new command handler functions added:

| Function | Description |
|---|---|
| `delete_tuples_cmd` | Prompts for table, WHERE clause, RETURNING flag; calls `delete_tuples` |
| `update_tuples_cmd` | Prompts for table, SET clause, WHERE clause, RETURNING flag; calls `update_tuples` |
| `compact_table_cmd` | Prompts for table name; calls `compaction_table` |

---

### `src/main.rs`

Background autovacuum worker pool is now started before the menu loop:

```rust
let av_handles = storage_manager::autovacuum::start(Arc::clone(&shutdown));
// ... menu runs ...
shutdown.store(true, Ordering::SeqCst);
for handle in av_handles { handle.join(); }
```

The `shutdown` flag is shared via `Arc<AtomicBool>` so the menu's Exit command signals all workers cleanly.
