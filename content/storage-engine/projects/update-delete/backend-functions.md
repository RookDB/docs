# Backend Functions

This page documents every new public backend function introduced in the update / delete / compaction phase, grouped by file.

---

## `src/backend/executor/delete.rs`

### `delete_tuples`

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

Main entry point for DELETE. Scans all data pages, soft-deletes every tuple that satisfies the DNF condition groups, updates the dead-tuple counter, refreshes the FSM, wakes autovacuum, and writes a log entry.

**Arguments:**

| Param | Description |
|---|---|
| `catalog` | Loaded catalog for schema lookup (column names and types) |
| `db_name` | Database name (used to form the file path) |
| `table_name` | Table name |
| `file` | Open read-write handle to the `.dat` file |
| `condition_groups` | DNF predicates — empty means match all rows |
| `returning` | If `true`, collect and return the deleted rows |

**Returns:** `DeleteResult { deleted_count, returning_rows }`

---

### `matches_condition_groups_pub`

```rust
pub fn matches_condition_groups_pub(
    decoded: &[(String, ColumnValue)],
    condition_groups: &[Vec<Condition>],
) -> bool
```

Public re-export of the core DNF evaluator. Re-used by `update.rs` so both operations share identical matching logic.

---

### `condition_to_json`

```rust
pub fn condition_to_json(c: &Condition) -> serde_json::Value
```

Serialises a single `Condition` to a JSON value for operation log entries.

---

## `src/backend/executor/update.rs`

### `update_tuples`

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

Main entry point for UPDATE. Two-phase: (1) collect matching `TuplePointer`s by scanning, (2) soft-delete old versions and reinsert modified tuples via `insert_raw_tuple`. Wakes autovacuum and logs the result.

**Arguments:**

| Param | Description |
|---|---|
| `assignments` | List of `SetAssignment` — one per `col = expr` in the SET clause |
| `condition_groups` | DNF WHERE predicates |
| `returning` | If `true`, collect and return the updated rows |

**Returns:** `UpdateResult { updated_count, returning_rows }`

---

### `parse_set_clause`

```rust
pub fn parse_set_clause(input: &str) -> Option<Vec<SetAssignment>>
```

Parses a raw SET string (e.g. `"score = score + 10, name = Unknown"`) into a typed `Vec<SetAssignment>`. Returns `None` if the string is empty or malformed.

---

### `parse_where_clause_with_schema`

```rust
pub fn parse_where_clause_with_schema(
    input: &str,
    columns: &[Column],
) -> Option<Vec<Vec<Condition>>>
```

Parses a raw WHERE string into DNF condition groups. Uses the column schema to infer whether literals are `Int` or `Text`. Returns `None` if the input is empty (meaning no filter — match all rows).

---

## `src/backend/executor/api.rs` — Integration Façade

These functions are the **official integration API** between the update/delete/compaction team and the heap/FSM team. They deliberately hide `HeapManager` and `FSM` internals.

### `insert_raw_tuple`

```rust
pub fn insert_raw_tuple(
    db_name: &str,
    table_name: &str,
    tuple_data: &[u8],
) -> io::Result<(u32, u32)>
```

Opens the table via `HeapManager::open` (which automatically rebuilds a stale or missing FSM) and inserts the given raw bytes into the best available page. Returns `(page_id, slot_id)`.

**Used by:** `update_tuples` for inserting new tuple versions.

---

### `rebuild_table_fsm`

```rust
pub fn rebuild_table_fsm(db_name: &str, table_name: &str) -> io::Result<()>
```

Deletes the existing `.dat.fsm` fork and rebuilds it from scratch by scanning the full heap (`FSM::build_from_heap`). Also persists the updated `fsm_page_count` in the table header so the next `HeapManager::open` sees a consistent header.

**Used by:** `delete_tuples` and `compaction_table` after mutations change free-space distribution.

---

## `src/backend/table/table_file.rs`

### `read_dead_tuple_count`

```rust
pub fn read_dead_tuple_count(file: &mut File) -> io::Result<u32>
```

Reads bytes 4–8 of the table header page (page 0) and returns the stored `dead_tuple_count` as a `u32`.

---

### `write_dead_tuple_count`

```rust
pub fn write_dead_tuple_count(file: &mut File, count: u32) -> io::Result<()>
```

Overwrites bytes 4–8 of the table header with the given count and flushes to disk.

---

### `increment_dead_tuple_count`

```rust
pub fn increment_dead_tuple_count(file: &mut File, delta: u32) -> io::Result<()>
```

Reads the current dead-tuple count, adds `delta` (saturating at `u32::MAX`), and writes the result back. Called after every soft-delete in both DELETE and UPDATE.

---

## `src/backend/page/page_lock.rs`

### `PageWriteLock::new`

```rust
impl PageWriteLock {
    pub fn new(file_id: u64, page_id: u32) -> Self
}
```

Acquires an exclusive write lock on the `(file_id, page_id)` pair, blocking until the lock is available. The lock is released when the returned `PageWriteLock` is dropped.

**Usage pattern:**

```rust
let _lock = PageWriteLock::new(file_id, page_id);
// read → modify → write page here
// lock released at end of scope
```

---

## `src/backend/log/operation_log.rs`

### `log_update` / `log_delete` / `log_compaction`

```rust
pub fn log_update(db_name: &str, table_name: &str, details: Value, status: &str) -> io::Result<()>
pub fn log_delete(db_name: &str, table_name: &str, details: Value, status: &str) -> io::Result<()>
pub fn log_compaction(db_name: &str, table_name: &str, details: Value, status: &str) -> io::Result<()>
```

Appends one JSON log entry to the corresponding log file under `database/logs/<db>/<table>/`. Creates the directory tree if it does not exist. Each entry contains a UTC ISO-8601 timestamp, operation name, caller-supplied details object, and a status string (`"success"` or `"error"`).

### `current_timestamp_iso`

```rust
pub fn current_timestamp_iso() -> String
```

Returns the current UTC time as a millisecond-precision ISO-8601 string (e.g. `"2026-04-20T12:34:56.789Z"`). Used by all three log functions.

---

## `src/backend/visibility_map/vm.rs`

### `vm_clear_page`

```rust
pub fn vm_clear_page(db_name: &str, table_name: &str, page_id: u32) -> io::Result<()>
```

Sets the VM bit for `page_id` to 0 (dirty). Called immediately after any slot in the page is soft-deleted, so autovacuum knows the page needs to be visited.

### `vm_set_page`

```rust
pub fn vm_set_page(db_name: &str, table_name: &str, page_id: u32) -> io::Result<()>
```

Sets the VM bit for `page_id` to 1 (all-visible). Called after compaction has successfully removed all dead tuples from the page.

### `vm_is_visible`

```rust
pub fn vm_is_visible(db_name: &str, table_name: &str, page_id: u32) -> io::Result<bool>
```

Returns `true` if the page's VM bit is 1. Used at the start of each page's compaction step to skip pages that have no dead tuples.

---

## `src/backend/heap/autovacuum.rs`

### `start`

```rust
pub fn start(shutdown: Arc<AtomicBool>) -> Vec<JoinHandle<()>>
```

Spawns `AUTOVACUUM_WORKERS` (3) background threads. Each thread shares the global `VacuumManager`. Returns the join handles so `main()` can wait for clean shutdown.

### `notify_table_write`

```rust
pub fn notify_table_write(db_name: &str, table_name: &str)
```

Called by `delete_tuples` and `update_tuples` after finishing. Reads `dead_tuple_count` from the table's header, computes priority, and if the table is eligible and not already queued, pushes a `HeapEntry` into the global max-heap and calls `condvar.notify_one()` to wake a sleeping worker.
