# Update, Delete, Compaction & Autovacuum

## Overview

This project implements the full **UPDATE / DELETE / COMPACTION** pipeline for RookDB, using a soft-delete model with a background autovacuum system.

---

## Sub-pages

| Page | Contents |
|---|---|
| [Data Structures](./data-structures.md) | All new data structures introduced in this phase |
| [File & Page Changes](./file-changes.md) | New files, modified files, page layout changes |
| [Backend Functions](./backend-functions.md) | Every new backend function and its purpose |
| [Frontend CLI Steps](./frontend-steps.md) | Interactive CLI usage for delete, update, and compact |
| [Algorithms](./algorithms.md) | DELETE, UPDATE, compaction, and autovacuum algorithms |
| [Benchmark Results](./benchmark.md) | RookDB vs PostgreSQL performance results |

---

## Core Design

RookDB follows a PostgreSQL-style **deferred-maintenance** model:

```text
DELETE / UPDATE (old version)  →  mark slot as deleted  (soft-delete)
SHOW / SCAN                    →  skip slots with SLOT_FLAG_DELETED
COMPACTION                     →  rewrite page, physically reclaim space
AUTOVACUUM                     →  background workers trigger compaction automatically
```

### Soft-delete slot layout

Each slot entry in a page item-id array is 8 bytes:

```text
[ offset: u32 (4 bytes) ][ length: u16 (2 bytes) ][ flags: u16 (2 bytes) ]
```

The deleted bit:

```text
SLOT_FLAG_DELETED = 0x0001
```

A slot with this bit set is **logically invisible**: scans skip it and updates never touch it.

### Table header layout (Page 0)

Page 0 of every `.dat` file is the table header, carrying two u32 counters:

```text
bytes 0..4  →  page_count        (u32, little-endian)
bytes 4..8  →  dead_tuple_count  (u32, little-endian)
bytes 8..   →  reserved / zeroed
```

`dead_tuple_count` is incremented by every DELETE and every UPDATE (old-version soft-delete). Autovacuum reads this counter to decide when to schedule compaction.

---

## Intermediate Files Generated

Every mutation operation produces structured log entries. Logs live at:

```text
database/logs/<db_name>/<table_name>/
    update.log
    delete.log
    compaction.log
```

Each log entry is a JSON object:

```json
{
  "timestamp": "2026-04-20T12:34:56.789Z",
  "operation": "delete",
  "details": { ... },
  "status": "success"
}
```

---

## Core APIs

### Update API

```rust
pub fn update_tuples(
    catalog: &Catalog,
    db_name: &str,
    table_name: &str,
    file: &mut File,
    assignments: &[SetAssignment],
    condition_groups: &[Vec<Condition>],
    returning: bool,
) -> io::Result<UpdateResult>
```

**Return value:**
- `UpdateResult.updated_count` — number of rows updated
- `UpdateResult.returning_rows` — updated rows when `RETURNING` is enabled

### Delete API

```rust
pub fn delete_tuples(
    catalog: &Catalog,
    db_name: &str,
    table_name: &str,
    file: &mut File,
    condition_groups: &[Vec<Condition>],
    returning: bool,
) -> io::Result<DeleteResult>
```

**Return value:**
- `DeleteResult.deleted_count` — number of rows deleted
- `DeleteResult.returning_rows` — deleted rows when `RETURNING` is enabled

### Compaction API

```rust
pub fn compaction_table(
    db_name: &str,
    table_name: &str,
) -> io::Result<usize>
```

**Return value:** number of data pages that were physically compacted.

---

## Cross-Team Integration Points

This component integrates with the heap/FSM team through `src/backend/executor/api.rs`.

| API / Function | Used for | Provided by |
|---|---|---|
| `insert_raw_tuple(db, table, data)` | Insert re-versioned tuple bytes during UPDATE | `api.rs` — delegates to `HeapManager::insert_tuple` |
| `rebuild_table_fsm(db, table)` | Rebuild FSM after DELETE or compaction changes free-space | `api.rs` — calls `FSM::build_from_heap` |

Autocompaction flow:

```
autovacuum worker → compaction_table() → rebuild_table_fsm() → FSM::build_from_heap()
```

---

## Testing & Robustness

### Edge cases covered

- Deleting all rows in a table
- Deleting rows already soft-deleted
- UPDATE with no matching rows
- Nested boolean predicates in WHERE (`(a AND b) OR c`)
- `LIKE` / `NOT LIKE` applied to INT columns (must not match)
- Compaction idempotency (running twice produces same result)
- Preserving live tuples during compaction
- Concurrent write safety at page level

### Test files

| File | Tests | Scope |
|---|---|---|
| `code/tests/test_update.rs` | 30 | Condition matching, arithmetic SET, zero-match updates, page-lock during update, RETURNING |
| `code/tests/test_delete.rs` | 57 | Soft-delete correctness, zero-match, delete-all, page-lock safety, WHERE edge cases |
| `code/tests/test_compaction.rs` | 10 | Live-tuple preservation, lock held during rewrite, idempotency, post-compaction free space |
| `code/tests/test_page_lock.rs` | — | PageWriteLock delays concurrent mutators by ≥ 4 500 ms |
| `code/tests/test_fsm_large.rs` | — | FSM correctness at scale after many inserts and compactions |

---

## Feature Status

| Feature | Status |
|---|---|
| Soft-delete via slot flags | ✅ Done |
| WHERE parser with DNF (AND / OR / parentheses) | ✅ Done |
| UPDATE with arithmetic SET | ✅ Done |
| Compaction | ✅ Done |
| Autovacuum thresholding | ✅ Done |
| Page-level locking | ✅ Done |
| Operation logging with ISO timestamps | ✅ Done |
| Visibility Map integration | ✅ Done |
| Benchmark harness (RookDB vs PostgreSQL) | ✅ Done |

---

## PostgreSQL References

- PostgreSQL Source Tree Version: PostgreSQL 19devel (`configure.ac:20`)
- PostgreSQL Documentation (devel): https://www.postgresql.org/docs/devel/
- PostgreSQL autovacuum design: https://www.postgresql.org/docs/devel/routine-vacuuming.html

---

## Potential Future Work

| Area | Description |
|---|---|
| MVCC | Replace soft-delete with transaction-ID stamped tuple versions |
| WAL integration | Write-ahead log before any mutation for crash recovery |
| Incremental compaction | Only compact pages above a dead-tuple density threshold |
| Index integration | Invalidate / update index entries on DELETE and UPDATE |
| Row-level locking | Upgrade from page-level to tuple-level locks |
