# New Data Structures

This page documents every new data structure introduced in the update / delete / compaction phase.

---

## 1. `VacuumManager`

**File:** `src/backend/heap/autovacuum.rs`

**Purpose:** Central singleton that coordinates all background autovacuum workers. Holds the priority queue of tables needing compaction, a registry of tracked tables, and a condvar to wake sleeping workers.

```rust
struct VacuumManager {
    heap:    Arc<Mutex<BinaryHeap<HeapEntry>>>,   // max-heap of work items
    tables:  Arc<Mutex<HashMap<String, Arc<Mutex<Table>>>>>, // per-table state
    condvar: Arc<Condvar>,                         // wake-up signal for workers
}
```

**Access:** Exposed as a process-global `OnceLock<Arc<VacuumManager>>` so all threads share one instance.

---

## 2. `HeapEntry`

**File:** `src/backend/heap/autovacuum.rs`

**Purpose:** One entry in the autovacuum priority queue. Stores a computed priority and a `"db::table"` key string. Implements `Ord` so the standard-library `BinaryHeap` acts as a max-heap.

```rust
struct HeapEntry {
    priority: isize,   // dead_tuple_count - threshold  (higher → more urgent)
    key:      String,  // "db_name::table_name"
}
```

**Priority formula:**

```
priority  = dead_tuple_count - threshold
threshold = 50 + 0.2 × table_size
```

---

## 3. `Table`

**File:** `src/backend/table/table_file.rs`

> **Pre-existing struct, modified this phase.** The `dead_tuple_count`, `in_heap`, and `in_use` fields were added.

**Purpose:** In-memory representation of a table's tracking state used by the autovacuum system. Carries the raw header-page bytes, the current dead-tuple count, the computed eviction threshold, and two boolean flags to avoid double-scheduling.

```rust
pub struct Table {
    pub data:             Vec<u8>,  // raw header page (8192 bytes)
    pub dead_tuple_count: usize,
    pub threshold:        usize,    // 50 + 0.2 * table_size
    pub in_heap:          bool,     // true if already queued in the priority heap
    pub in_use:           bool,     // true if a worker is currently compacting this table
}
```

---

## 4. `TableHeader`

**File:** `src/backend/table/table_file.rs`

> **Pre-existing struct, modified this phase.** The `dead_tuple_count` field was added (previously only `page_count` was stored).

**Purpose:** Typed view of the first 8 bytes of page 0. Used when reading or writing the header fields without touching the rest of the page.

```rust
pub struct TableHeader {
    pub page_count:       u32,
    pub dead_tuple_count: u32,
}
```

**On-disk layout (page 0):**

```
bytes 0..4  →  page_count        (u32 LE)
bytes 4..8  →  dead_tuple_count  (u32 LE)
bytes 8..   →  reserved / zeroed
```

---

## 5. `PageWriteLock` / `PageLockRegistry`

**File:** `src/backend/page/page_lock.rs`

**Purpose:** RAII guard that holds an exclusive mutex over a `(file_id, page_id)` pair. Prevents two concurrent writers (e.g., a background compaction worker and a foreground DELETE) from modifying the same page simultaneously.

```rust
pub struct PageWriteLock {
    key:    PageKey,                                 // (file_id, page_id)
    _guard: MutexGuard<'static, ()>,                 // released on drop
}

struct PageLockRegistry {
    locks: HashMap<PageKey, Arc<Mutex<()>>>,
}
```

**Key type:**

```rust
struct PageKey {
    file_id: u64,   // unique OS inode-derived identity for each .dat file
    page_id: u32,
}
```

Independent pages can be locked simultaneously by different threads; only the same `(file_id, page_id)` pair serializes.

---

## 6. `Condition` / `Operator` / `ColumnValue`

**File:** `src/backend/executor/delete.rs` (re-used by `update.rs`)

**Purpose:** Typed representation of a single WHERE predicate. Grouped in DNF (Disjunctive Normal Form) to support arbitrary AND/OR nesting.

```rust
pub enum Operator { Eq, Ne, Lt, Le, Gt, Ge, Like, NotLike, In, NotIn }

pub enum ColumnValue {
    Int(i32),
    Text(String),
    List(Vec<ColumnValue>),   // for IN / NOT IN
}

pub struct Condition {
    pub column:   String,
    pub operator: Operator,
    pub value:    ColumnValue,
}
```

**WHERE clause DNF structure:**

```
Vec<Vec<Condition>>
  outer Vec  →  OR  groups  (row matches if ANY group matches)
  inner Vec  →  AND clauses (group matches if ALL conditions match)
```

---

## 7. `SetAssignment` / `SetExpr` / `ArithOp`

**File:** `src/backend/executor/update.rs`

**Purpose:** Typed representation of one `col = <expr>` clause from an UPDATE SET list. Supports both literal assignment and arithmetic expressions referencing the current column value.

```rust
pub enum ArithOp { Add, Sub, Mul, Div }

pub enum SetExpr {
    Literal(ColumnValue),
    Expr {
        src_col: String,
        op:      ArithOp,
        rhs_i:   i64,   // for Add / Sub
        rhs_f:   f64,   // for Mul / Div
    },
}

pub struct SetAssignment {
    pub column: String,
    pub expr:   SetExpr,
}
```

**Examples:**

| SET input | Parsed as |
|---|---|
| `age = 25` | `SetExpr::Literal(Int(25))` |
| `age = age + 1` | `SetExpr::Expr { src_col: "age", op: Add, rhs_i: 1 }` |
| `salary = salary * 1.10` | `SetExpr::Expr { src_col: "salary", op: Mul, rhs_f: 1.10 }` |

---

## 8. `DeleteResult` / `UpdateResult`

**File:** `src/backend/executor/delete.rs`, `update.rs`

**Purpose:** Return types from the primary executor functions, carrying the affected-row count and optionally the rows themselves (for RETURNING).

```rust
pub struct DeleteResult {
    pub deleted_count:  usize,
    pub returning_rows: Vec<Vec<(String, String)>>,
}

pub struct UpdateResult {
    pub updated_count:  usize,
    pub returning_rows: Vec<Vec<(String, String)>>,
}
```

---

## 9. `VmCache` / `VmRegistry`

**File:** `src/backend/visibility_map/vm.rs`

**Purpose:** In-memory write-back cache for the per-table Visibility Map (VM). Batches dirty bit-updates in memory and flushes to disk only when needed, avoiding a read-modify-write on every single DELETE.

```rust
struct VmCache {
    bytes: Vec<u8>,   // one bit per heap page (1 = all-visible, 0 = dirty)
    dirty: bool,
}

struct VmRegistry {
    tables: HashMap<String, VmCache>,  // key = "db::table"
}
```

**Bit layout:**

```
byte index  =  page_id / 8
bit position = page_id % 8
1 → page is all-visible (autovacuum can skip)
0 → page is dirty       (autovacuum must visit)
```


