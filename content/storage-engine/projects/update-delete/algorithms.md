# Algorithms

This page describes the algorithms behind DELETE, UPDATE, compaction, autovacuum scheduling, page locking, and the Visibility Map.

---

## 1. DELETE Algorithm

**File:** `src/backend/executor/delete.rs` → `delete_tuples()`

DELETE is implemented as **logical (soft) deletion**. No bytes are physically moved at delete time; only a flag is set in the slot array so the row is invisible to scans. Physical reclamation is deferred to compaction.

### Steps

```
1.  Read page_count from the table header (page 0).
2.  For each data page  p  in  1 .. page_count:
    a.  Acquire PageWriteLock(file_id, p).
    b.  Read the page from disk.
    c.  Parse the item-ID array to find all live slots
        (skip slots where SLOT_FLAG_DELETED is already set).
    d.  Decode each live tuple into typed column/value pairs.
    e.  Evaluate the DNF condition groups against the decoded tuple.
    f.  If the tuple matches:
          i.  Set SLOT_FLAG_DELETED in the slot's flags field.
         ii.  Compute the new free-space value for this page.
        iii.  Call vm_clear_page(db, table, p)   → mark page dirty in VM.
    g.  Write the modified page back to disk.
    h.  Release PageWriteLock (guard drops automatically).
    i.  Call increment_dead_tuple_count(file, matched_on_page).
3.  Call rebuild_table_fsm(db, table) to refresh the FSM with the
    new free-space values (deleted slots free up space for inserts).
4.  Call notify_table_write(db, table) to wake autovacuum if the
    dead-tuple counter now exceeds the threshold.
5.  Log the result to  database/logs/<db>/<table>/delete.log.
6.  Return DeleteResult { deleted_count, returning_rows }.
```

### DNF condition evaluation

```
condition_groups: Vec<Vec<Condition>>   (outer = OR, inner = AND)

matches(row) = ANY group in outer  where  ALL conditions in group hold
```

Empty `condition_groups` → matches every row (DELETE ALL).

### Supported WHERE operators

| Operator | INT | TEXT |
|---|---|---|
| `=` `!=` | ✓ | ✓ case-insensitive |
| `<` `<=` `>` `>=` | ✓ | ✓ lexicographic |
| `IN` / `NOT IN` | ✓ | ✓ |
| `LIKE` / `NOT LIKE` | ✗ | ✓ (`%` = any sequence, `_` = any char) |
| `AND` / `OR` / `( )` grouping | ✓ | ✓ |

---

## 2. UPDATE Algorithm

**File:** `src/backend/executor/update.rs` → `update_tuples()`

UPDATE is implemented as **delete-old-version + insert-new-version** (append-on-update). This keeps tuple-writing logic centralised in the heap insertion path and avoids in-place byte shuffling inside slotted pages.

### Steps

```
Phase 1 — Scan and collect matching TuplePointers
──────────────────────────────────────────────────
1.  Read page_count from the table header.
2.  For each data page  p  in  1 .. page_count:
    a.  Read the page (no lock needed for the read phase).
    b.  Decode each live slot (SLOT_FLAG_DELETED == 0).
    c.  Evaluate DNF condition groups.
    d.  If matched: record TuplePointer { page_id: p, slot_index }.

Phase 2 — Soft-delete old versions
────────────────────────────────────
3.  For each collected TuplePointer:
    a.  Acquire PageWriteLock(file_id, pointer.page_id).
    b.  Re-read the page (re-validate; the slot may have been deleted
        concurrently between Phase 1 and Phase 2).
    c.  Verify the slot is still live.
    d.  Apply SET assignments to build the new tuple bytes.
    e.  Set SLOT_FLAG_DELETED on the old slot.
    f.  Call vm_clear_page(db, table, pointer.page_id).
    g.  Call increment_dead_tuple_count(file, 1).
    h.  Write the modified page back to disk.
    i.  Release PageWriteLock.

Phase 3 — Insert new versions
──────────────────────────────
4.  For each new tuple byte slice:
    a.  Call insert_raw_tuple(db, table, new_bytes)
        which delegates to HeapManager::insert_tuple.
        HeapManager uses the FSM to find a page with sufficient
        free space, or allocates a new page if needed.

Phase 4 — Post-update housekeeping
────────────────────────────────────
5.  Call notify_table_write(db, table).
6.  Log the result to  database/logs/<db>/<table>/update.log.
7.  Return UpdateResult { updated_count, returning_rows }.
```

### Why delete + insert instead of in-place overwrite?

- The new tuple may be a different size than the old one if TEXT values change length.
- Centralising writes in `HeapManager::insert_tuple` ensures FSM and page-header bookkeeping are always consistent.
- Matches PostgreSQL's MVCC append model (simplified, no transaction IDs).

---

## 3. Compaction Algorithm

**File:** `src/backend/executor/delete.rs` (compaction path is called from `compaction_table`)

Compaction physically rewrites each page, moving all live tuples to the front and zeroing dead-slot space.

### Steps

```
1.  Read page_count from the table header.
2.  For each data page  p  in  1 .. page_count:
    a.  Check vm_is_visible(db, table, p).
        If true → page has no dead tuples; skip it entirely.
    b.  Acquire PageWriteLock(file_id, p).
    c.  Read the page.
    d.  Collect all live slots (SLOT_FLAG_DELETED == 0) + their raw bytes.
    e.  Rebuild the page from scratch:
          i.  Zero the entire page buffer.
         ii.  Re-insert live tuples compactly from offset 0.
        iii.  Rewrite the item-ID array to reflect the new offsets.
         iv.  Update the page header (tuple count, free-space pointer).
    f.  Write the rebuilt page back to disk.
    g.  Call vm_set_page(db, table, p) → mark page all-visible.
    h.  Release PageWriteLock.
3.  Reset dead_tuple_count to 0 in the table header.
4.  Call rebuild_table_fsm(db, table) so the FSM reflects the
    newly reclaimed free space.
5.  Log the result to  database/logs/<db>/<table>/compaction.log.
6.  Return the count of pages that were physically rewritten.
```

---

## 4. Autovacuum Scheduling Algorithm

**File:** `src/backend/heap/autovacuum.rs`

### Priority formula

```
threshold = 50 + 0.2 × table_size          (table_size = page_count)
priority  = dead_tuple_count − threshold
```

A table is **eligible** for compaction when `priority > 0`.

### Worker loop (per worker thread, 3 workers total)

```
loop:
  lock the global max-heap
  if heap is empty:
    condvar.wait_timeout(50 ms)        // sleep until notified or timeout
    continue
  entry = heap.pop()                   // highest-priority table
  if table.in_use:
    continue                           // another worker already on it; skip
  table.in_use = true
  release lock

  run compaction_table(db, table)

  lock the global max-heap
  table.in_use = false
  re-read dead_tuple_count             // did foreground mutations create more dead tuples?
  if dead_tuple_count > threshold:
    heap.push(entry with updated priority)   // re-schedule
  release lock
```

### Notification path

Every DELETE and UPDATE calls `notify_table_write(db, table)` after finishing. This function:

1. Reads `dead_tuple_count` from the header.
2. Computes `priority`.
3. If `priority > 0` and the table is not already in the heap: pushes a `HeapEntry` and calls `condvar.notify_one()`.

---

## 5. Page-Level Write Locking

**File:** `src/backend/page/page_lock.rs`

### Lock acquisition

```
PageWriteLock::new(file_id, page_id):
  key = PageKey { file_id, page_id }
  lock the global PageLockRegistry mutex
  get or create Arc<Mutex<()>> for key
  release registry mutex
  block until the page's Mutex<()> is acquired
  return PageWriteLock { key, _guard }
```

The `_guard` (a `MutexGuard<'static, ()>`) is held for the lifetime of the `PageWriteLock`. When the guard drops (on scope exit or manual `drop(...)`), the mutex is released and any other thread waiting on that page can proceed.

### Concurrency properties

- Two threads can hold locks on **different** pages of the same file simultaneously.
- Two threads on the **same** `(file_id, page_id)` pair are fully serialised.
- The registry lock itself is held only for the time needed to look up or insert the page's `Arc<Mutex<()>>`; it is not held while waiting for the page lock.

---

## 6. Visibility Map Algorithm

**File:** `src/backend/visibility_map/vm.rs`

The VM is a compact bitfield file (`<table>_vm`) that tracks whether each heap page contains **zero** dead tuples.

### Bit layout

```
VM file byte at index  (page_id / 8)
bit position           (page_id % 8)

1 → all-visible  (autovacuum can skip this page)
0 → dirty        (page may have dead tuples)
```

### Operations

| Function | When called | What it does |
|---|---|---|
| `vm_clear_page(db, tbl, page_id)` | DELETE / UPDATE | Sets bit `page_id` to 0 in the in-memory cache and flushes to disk |
| `vm_set_page(db, tbl, page_id)` | After compacting a page | Sets bit `page_id` to 1 and flushes |
| `vm_is_visible(db, tbl, page_id)` | Start of compaction per-page check | Returns true if bit is 1 → skip the page entirely |

### In-memory cache

Updates go through `VmRegistry` (an in-memory `HashMap` of `VmCache`). This avoids a full file read-modify-write per deleted row. The cache is flushed on every `vm_clear_page` / `vm_set_page` call to ensure durability.

---

## 8. In-Depth Design Notes

### Deferred-maintenance model

RookDB separates **foreground mutation** from **background reclaim**:

- Foreground operations (INSERT, UPDATE, DELETE) perform only logical changes — no physical page reorganisation.
- Background autovacuum workers perform the physical reclaim asynchronously.

This keeps foreground write latency predictable and lock hold-times short. Compaction is page-local, rewriting only pages with dead slots.

### PostgreSQL scheduling vs RookDB autovacuum

PostgreSQL autovacuum uses a threshold-based eligibility check and worker-driven relation selection (via `pg_stat_user_tables`).

RookDB introduces an explicit **priority-based scheduling queue**:

- Each eligible table is assigned a priority: `dead_tuple_count − threshold`.
- Tables are pushed into a process-global `BinaryHeap<HeapEntry>` (max-heap).
- Workers always pick the highest-priority table next, focusing cleanup effort on relations with the most immediate reclaim pressure.

```
priority  = dead_tuple_count − threshold
threshold = 50 + 0.2 × table_size
```

This differs from PostgreSQL's round-robin worker selection and more closely resembles a priority-aware vacuum daemon.

**File:** `src/backend/executor/delete.rs` (parser lives in `src/backend/executor/`)

User input like:

```
(dept = HR AND salary < 60000) OR dept = Sales
```

is parsed into a `Vec<Vec<Condition>>`:

```
[
  [ Condition(dept = HR), Condition(salary < 60000) ],   // AND group 1
  [ Condition(dept = Sales) ],                            // AND group 2
]
```

Evaluation: a row matches if **any** outer group matches (OR), and a group matches if **all** inner conditions match (AND). This is standard Disjunctive Normal Form.

Nested expressions are flattened to DNF by distributing AND over OR during parsing.
