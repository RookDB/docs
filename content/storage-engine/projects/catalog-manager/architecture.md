---
title: Architecture
sidebar_position: 2
---

# Catalog Manager — Architecture

## Catalog Storage Architecture

The Catalog Manager introduces a **page-based storage backend** that stores system catalog metadata in dedicated `.dat` files under `database/global/catalog_pages/`. Each catalog file follows the same slotted-page format used by user tables, enabling seamless integration with the buffer manager.

### Directory Layout

```
database/
├── global/
│   ├── catalog_pages/              # Page-based catalog storage
│   │   ├── pg_database.dat         # System catalog: databases
│   │   ├── pg_table.dat            # System catalog: tables
│   │   ├── pg_column.dat           # System catalog: columns
│   │   ├── pg_constraint.dat       # System catalog: constraints
│   │   ├── pg_index.dat            # System catalog: indexes
│   │   └── pg_type.dat             # System catalog: data types
│   ├── pg_oid_counter.dat          # Persistent OID counter
│   └── catalog.json                # Unused legacy file (can be removed)
└── base/
    └── {database}/
        ├── {table}.dat             # User table data files
        └── indexes/                # Index files
            └── {index_name}.idx
```

### Design Rationale

| Aspect | Rationale |
|--------|-----------|
| Page-based storage | Enables buffer manager integration for efficient caching |
| System catalogs | Provides self-hosting capabilities similar to PostgreSQL |
| Separation of concerns | System metadata is cleanly separated from user data |
| Scalability | Supports large numbers of databases, tables, and constraints |

---

## Page Layout for Catalog Pages

Catalog pages use the **identical slotted-page layout** as user table files, consistent with RookDB's existing page structure:

- **Page 0** — Table header (8,192 bytes; first 4 bytes = total page count)
- **Page 1+** — Slotted data pages (8,192 bytes each)

Each data page consists of:
- A **page header** (lower and upper pointers, 8 bytes)
- An **Item ID array** growing forward from the header
- **Tuple data** appended from the end of the page backward

> **Implementation Note:** Catalog files are initialised using the same `init_table()` function as user tables. The original design document did not specify the page-0 length, leading to the discovery that a short header would break all seeks in the disk manager (see [Implementation Notes](./implementation-notes.md) §1).

---

## Buffer Manager Integration

All catalog page I/O is routed through the existing Buffer Manager using `pin_page()` / `unpin_page()` semantics:

- **`CatalogPageManager`** maps catalog names to file paths and delegates all reads/writes to the buffer pool.
- **Pin/unpin** semantics prevent eviction of actively used catalog pages.
- **Dirty tracking** ensures modified catalog pages are written back to disk.
- **LRU replacement** maximises cache hit rate for frequently accessed catalogs.

The integration points are:

```rust
// Every CRUD operation uses the buffer manager
pm.insert_catalog_tuple(bm, CAT_TABLE, bytes)?;
pm.scan_catalog(bm, CAT_DATABASE)?;
pm.delete_catalog_tuple(bm, CAT_INDEX, page_num, slot_id)?;
```

---

## OID (Object Identifier) System

Every database object is assigned a globally unique **32-bit Object Identifier (OID)**. OIDs enable referential integrity across the system catalog tables.

### OID Ranges

| Range | Purpose |
|-------|---------|
| `1 – 9,999` | Reserved for built-in types and system objects |
| `10,000+` | User-created objects (databases, tables, columns, etc.) |

### Persistence

The next available OID is stored as a little-endian `u32` in `database/global/pg_oid_counter.dat`:

- On startup, the counter is loaded from this file.
- When the page backend is active, every `alloc_oid()` call writes the incremented counter directly to the file, preventing OID reuse after a crash.
- In legacy JSON mode, the counter is captured implicitly inside `catalog.json`.

### Allocation

```rust
pub fn alloc_oid(&mut self) -> u32 {
    let oid = self.oid_counter;
    self.oid_counter += 1;
    if self.page_backend_active {
        // Write to pg_oid_counter.dat immediately
    }
    oid
}
```

---

## Core Components

The Catalog Manager consists of eight core modules (~3,000 lines of Rust) orchestrated by the main `Catalog` struct. Each module handles a specific aspect of metadata management.

### 1. Type System (`types.rs`, 485 lines)

Defines all data structures and enums used throughout the catalog. Key types:

- **`DataType`** — Represents a single data type (OID, name, category, alignment, length)
  - 10 built-in types with PostgreSQL-like OID ranges (1-10 for built-ins, 10,000+ for user types)
  - Methods: `from_name()` for type resolution, alias support (INTEGER → INT, REAL → FLOAT, BYTEA → BYTES)
  
- **`Column`** — Represents a column within a table
  - Stores: OID, name, position, type, modifiers, nullable flag, default value, constraint OIDs
  - Position is 1-based and immutable after column creation
  
- **`Constraint`** — Represents a constraint with type-specific metadata
  - **PrimaryKey**: Backed by unique index (stores `index_oid`)
  - **ForeignKey**: Stores referenced table/columns and ON DELETE/UPDATE actions (Cascade, SetNull, Restrict, NoAction)
  - **Unique**: Backed by unique index
  - **NotNull**: Simple flag on column
  - **Check**: Stores expression string for future validation
  
- **`Index`** — Represents a B-Tree index
  - Supports multi-column indexes
  - Tracks unique and primary key flags
  - Stores page count for statistics

### 2. Binary Serialization (`serialize.rs`, 416 lines)

Converts catalog structs to/from compact little-endian binary format for disk storage. Each tuple type (Database, Table, Column, Constraint, Index, Type) has a dedicated serializer.

**Serialization format:**
- Fixed types: u32/u64/u16/i16/u8 in LE byte order
- Strings: `[u16 length (LE)] [UTF-8 bytes]`
- Arrays: `[u16 count (LE)] [N × element]`
- Enums: Converted to u8 via `to_u8()`/`from_u8()`

Example — Database tuple:
```
[db_oid:4][owner_len:2][owner:N][name_len:2][name:N][created_at:8][encoding:1]
```

This module ensures that complex Rust structs can be transparently stored in variable-length slots on catalog pages.

### 3. Page Manager (`page_manager.rs`, 289 lines)

Low-level CRUD interface for system catalogs, delegating all page I/O to the Buffer Manager.

**Key methods:**

- **`insert_catalog_tuple(bm, catalog_name, bytes) → (page, slot)`**
  - Finds page with free space or allocates new page
  - Appends tuple to page
  - Returns exact slot ID computed from the page's `lower` pointer
  
- **`scan_catalog(bm, catalog_name) → Vec<Vec<u8>>`**
  - Iterates all pages in a catalog file
  - Collects live tuples (skips deleted ones with length=0)
  - Triggers one page read per page in the catalog
  
- **`delete_catalog_tuple(bm, page, slot)`**
  - Marks slot as deleted by zeroing its length field
  - Does NOT compact the page (deferred via future `vacuum_catalog`)
  
- **`find_catalog_tuple(bm, catalog_name, predicate) → (page, slot, bytes)`**
  - Scans pages until predicate returns true
  - Returns raw bytes without deserializing (efficient for lookups)
  
- **`update_catalog_tuple(bm, page, slot, new_bytes) → (new_page, new_slot)`**
  - Uses **delete-then-reinsert** strategy for variable-length updates
  - Returns new location so callers update their cache

### 4. OID System (`oid.rs`, 110 lines)

Manages globally unique 32-bit Object Identifiers with crash-safe persistence.

- Stores next OID as little-endian u32 in `pg_oid_counter.dat`
- Built-in types: OIDs 1–10
- User objects: Start at OID 10,000 (`USER_OID_START`)
- **Critical:** Every `allocate_oid()` writes immediately to disk when `page_backend_active == true`
  - Prevents OID reuse after crashes
  - In legacy mode (no page backend), the counter is not persisted by `alloc_oid()`

### 5. In-Memory Cache (`cache.rs`, 236 lines)

LRU cache reducing disk I/O for frequently accessed metadata. Default capacity: 256 entries.

**Cache entries:**
- `databases`: HashMap of `Database` structs by name
- `tables`: HashMap of `Table` structs by `(db_oid, table_name)` tuple
- `constraints`: HashMap of constraint vectors by `table_oid`
- `indexes`: HashMap of index vectors by `table_oid`
- `types`: HashMap of `DataType` structs by OID

**Eviction strategy:**
- LRU: Oldest accessed entry evicted when capacity exceeded
- `access_order` vector tracks access ordering

**Invalidation policy:**
- **Eager invalidation on every DDL operation**
- `create_table()` calls `cache.insert_table()` after creation
- `drop_table()` calls `invalidate_table()`, `invalidate_constraints()`, `invalidate_indexes()`
- `add_*_constraint()` and `drop_index()` call `invalidate_constraints()` / `invalidate_indexes()`
- Ensures stale data is never served to queries

### 6. Constraint System (`constraints.rs`, 411 lines)

High-level constraint management with enforcement infrastructure.

**Constraint creation functions:**
- **`add_primary_key_constraint()`**: Validates no existing PK, sets columns NOT NULL, creates backing index, persists to pg_constraint
- **`add_foreign_key_constraint()`**: Validates referenced columns are PK/UNIQUE, stores with cascading actions
- **`add_unique_constraint()`**: Creates backing index, persists metadata
- **`add_not_null_constraint()`**: Updates column `is_nullable` field via delete-then-reinsert in pg_column, persists a NOT NULL constraint record to pg_constraint

**Constraint validation:**
- **`validate_constraints(table_oid, values)`** — Runtime validation during INSERT/UPDATE
  - NOT NULL: Checks values present
  - UNIQUE: B-Tree index lookup (no duplicates)
  - FK: Verifies referenced row exists (when enforcement enabled)
  - CHECK: Expression evaluation (future)

### 7. Index Operations (`indexes.rs`, 440 lines)

B-Tree index management for constraint enforcement and query optimization.

**Index operations:**
- **`create_index()`**
  - Allocates index OID
  - Creates B-Tree file: `database/base/{db}/{index_name}.idx`
  - Writes initial root page
  - Persists metadata to pg_index
  - Associates with table
  
- **`drop_index()`**
  - Uses `find_catalog_tuple()` to get real `(page, slot)` (not fabricated values)
  - Deletes tuple from pg_index
  - Removes `.idx` file
  
- **`index_lookup(bm, db_name, index_name, key_bytes) → bool`**
  - B-Tree traversal: root → leaf → binary search
  - Returns boolean (used by UNIQUE and FK constraint validation)
  
- **`insert_index_entry(bm, db_name, index_name, key_bytes, page_num, slot_id)`**
  - Called after INSERT passes constraints
  - Updates B-Tree structure

### 8. Core Orchestration (`catalog.rs`, 615 lines)

High-level API coordinating all components. Main struct `Catalog` holds:

- `oid_counter`: Next OID to allocate
- `page_backend_active`: Boolean flag indicating page backend is active
- `bootstrap_mode`: Flag for initialization phase
- `cache`: The LRU `CatalogCache` instance

Databases and tables are **not stored in the `Catalog` struct**; they are stored in the system catalog pages and accessed on-demand via the cache.

**Public operations:**
- **`create_database()`**: Allocate OID, create directory, insert to pg_database, invalidate cache
- **`drop_database()`**: Drop all tables, delete from pg_database, remove directory
- **`create_table()`**: Allocate table OID, create columns, apply constraints, initialize data file
- **`drop_table()`**: Check FK dependencies, drop indexes, delete constraints/columns, remove file
- **`alter_table_add_column()`**: Allocate column OID, insert to pg_column, return new OID

---

## Catalog Cache & Lazy Loading

The RookDB Catalog Manager employs a **lazy-loading** strategy to manage metadata. Unlike the legacy system, which loaded all metadata into memory at startup, the new system only loads metadata when it is explicitly requested (e.g., when opening a database or querying a table's schema).

### Catalog Cache

The in-memory **LRU Catalog Cache** is the central component of this strategy, reducing disk I/O for frequently accessed metadata:

- **Max size:** 256 entries (configurable).
- **Eviction:** LRU (Least Recently Used) — when capacity is reached, the oldest entry is removed.
- **Invalidation:** Every DDL operation (CREATE, ALTER, DROP) eagerly invalidates affected cache entries.
- **Lazy Population:** The cache is populated on-demand. If a request for `get_table()` misses the cache, the system scans the `pg_table` catalog on disk, populates the cache, and returns the entry.

### Decoupled Entity Architecture

To support lazy loading and scalability, the in-memory data structures are **normalized and decoupled**. 

- **No Nesting:** A `Database` struct does not contain a list of `Table` objects, and a `Table` struct does not contain its `Column` objects. 
- **OID Linking:** Entities refer to each other via **OIDs**. For example, a `Table` record stores its parent `db_oid`.
- **Runtime Resolution:** When a full view of a table is needed (e.g., for query planning), the `get_table_metadata()` function orchestrates the resolution by looking up the table, its columns, its constraints, and its indexes as separate entities from the cache or disk.

### Invalidation Points

| Operation | Invalidation |
|-----------|-------------|
| `create_database` | `invalidate_database(db_name)` |
| `drop_database` | `invalidate_database(db_name)` |
| `create_table` | `invalidate_table(db_oid, table_name)` |
| `drop_table` | `invalidate_table`, `invalidate_constraints`, `invalidate_indexes` |
| `alter_table_add_column` | `invalidate_constraints(table_oid)` |
| `add_*_constraint` | `invalidate_constraints(table_oid)` |
| `create_index` / `drop_index` | `invalidate_indexes(table_oid)` |

---

## Initialization

### Startup Flow

```
init_catalog(bm)
  │
  ├── catalog_pages/ exists?
  │     └── YES → Load page backend (lazy; no catalog scan at startup)
  │
  └── NO → Bootstrap
            ├── Create catalog_pages/ directory
            ├── Initialize all 6 system catalog files
            ├── Register built-in types in pg_type
            └── Create "system" database record in pg_database
```

### Bootstrap

On a fresh install, `bootstrap_catalog()`:

1. Creates the `database/global/catalog_pages/` directory
2. Initialises the OID counter at `10,000`
3. Creates all six system catalog `.dat` files using `init_table()`
4. Registers all 10 built-in data types into `pg_type`
5. Inserts the system database record (`db_oid=1`, `name="system"`) into `pg_database`

---

## Complete End-to-End Example: CREATE TABLE with PRIMARY KEY

This example traces a complete DDL sequence through the catalog layers, demonstrating how components interact from SQL parsing to persistent storage.

**SQL Statement:**
```sql
CREATE TABLE users (
    id INT PRIMARY KEY,
    name TEXT NOT NULL
);
```

### Execution Flow

```
1. Frontend parses DDL → ColumnDefinitions & ConstraintDefinitions

   ColumnDefinitions:
   ├── {name: "id", type: "INT", nullable: false}
   └── {name: "name", type: "TEXT", nullable: false}
   
   ConstraintDefinitions:
   ├── PrimaryKey(["id"])
   └── NotNull("name")

2. catalog.rs::create_table() called
   └─→ Validates database exists, table name unique

3. Allocate OIDs:
   ├── table_oid = catalog.alloc_oid() = 10000
   │   └─→ Persists to pg_oid_counter.dat
   │
   ├── column_oid (id) = catalog.alloc_oid() = 10001
   │   └─→ Persists to pg_oid_counter.dat
   │
   └── column_oid (name) = catalog.alloc_oid() = 10002
       └─→ Persists to pg_oid_counter.dat

4. Process Columns:
   
   a) Column "id" (INT):
      ├── DataType::from_name("INT") → DataType { oid: 1, category: Numeric, length: 4, align: 4 }
      ├── serialize.rs::serialize_column_tuple()
      │   └─→ [col_oid:4][table_oid:4][name_var][pos:2][type_oid:4][...]
      │   └─→ (52 bytes) → raw_bytes_1
      │
      └── page_manager.rs::insert_catalog_tuple(bm, "pg_column", raw_bytes_1)
          ├─→ Find page with free space in pg_column.dat (or create page)
          ├─→ Append to page (update upper pointer, add slot)
          └─→ Return (page=1, slot=0)

   b) Column "name" (TEXT):
      ├── DataType::from_name("TEXT") → DataType { oid: 6, category: String, length: -1, align: 1 }
      ├── serialize_column_tuple()
      │   └─→ (48 bytes) → raw_bytes_2
      │
      └── insert_catalog_tuple(bm, "pg_column", raw_bytes_2)
          └─→ Return (page=1, slot=1)

5. Create Table File:
   ├── Create: database/base/{db}/users.dat
   └── init_table() via Buffer Manager
       ├─→ Write page 0 (header with page_count=2)
       └─→ Write page 1 (empty slotted page)

6. Insert Table Metadata to pg_table:
   ├── serialize_table_tuple()
   │   └─→ [table_oid:4][name_var][db_oid:4][table_type:1][row_count:8][page_count:4][...]
   │   └─→ (45 bytes) → raw_bytes_table
   │
   └── insert_catalog_tuple(bm, "pg_table", raw_bytes_table)
       ├─→ Find or create page
       └─→ Return (page=1, slot=2)

7. In-memory Cache Update:
   └─→ catalog.cache.insert_table(
           Table {
               table_oid: 10000,
               table_name: "users",
               db_oid: <db_oid>,
               columns: [Column{oid:10001, name:"id", ...}, Column{oid:10002, name:"name", ...}]
           }
       )

8. Process Constraint #1 — PrimaryKey(["id"]):
   ├── constraints.rs::add_primary_key_constraint()
   │   ├─→ Resolve "id" → column_oid=10001
   │   ├─→ Set column is_nullable = false
   │   │   └─→ pg_column update: delete-then-reinsert (new page/slot)
   │   │
   │   └─→ indexes.rs::create_index(unique=true, primary=true)
   │       ├─→ index_oid = catalog.alloc_oid() = 10003
   │       │   └─→ Persists to pg_oid_counter.dat
   │       │
   │       ├─→ Create: database/base/{db}/indexes/pk_users_id.idx
   │       │   └─→ B-Tree root page initialized
   │       │
   │       ├─→ serialize_index_tuple()
   │       │   └─→ [index_oid:4][name_var][table_oid:4][type:1][cols_var][unique:1][primary:1][pages:4]
   │       │   └─→ (42 bytes) → raw_bytes_idx
   │       │
   │       └─→ insert_catalog_tuple(bm, "pg_index", raw_bytes_idx)
   │           └─→ Return (page=1, slot=0)
   │
   └─→ serialize_constraint_tuple()
       └─→ [constr_oid:4][name_var][type:1][table_oid:4][cols_var][pk_index_oid:4]
       └─→ (38 bytes) → raw_bytes_constr
       
       insert_catalog_tuple(bm, "pg_constraint", raw_bytes_constr)
       └─→ Return (page=1, slot=0)

9. Process Constraint #2 — NotNull("name"):
   └─→ constraints.rs::add_not_null_constraint()
       ├─→ Set column is_nullable = false (already false, no-op)
       └─→ Serialize and insert to pg_constraint (similar to above)

10. Cache Invalidation:
    └─→ catalog.cache.invalidate_database(db_name)
        └─→ Clears entry from cache (will reload on next access)

11. Return Result:
    └─→ Ok(table_oid=10000)
```

### Disk State After CREATE TABLE

```
database/global/catalog_pages/
├── pg_database.dat
│   ├── Page 0: [page_count=2][reserved]
│   └── Page 1: (no new database entries)
│
├── pg_table.dat
│   ├── Page 0: [page_count=2][reserved]
│   └── Page 1: Slotted page with 1 tuple (users table metadata)
│
├── pg_column.dat
│   ├── Page 0: [page_count=2][reserved]
│   └── Page 1: Slotted page with 2 tuples (id column, name column)
│
├── pg_constraint.dat
│   ├── Page 0: [page_count=2][reserved]
│   └── Page 1: Slotted page with 2 tuples (PK constraint, NOT NULL constraint)
│
├── pg_index.dat
│   ├── Page 0: [page_count=2][reserved]
│   └── Page 1: Slotted page with 1 tuple (pk_users_id index metadata)
│
├── pg_type.dat
│   └── (unchanged, contains 10 built-in types)
│
└── pg_oid_counter.dat
    └── [00 00 00 0A] (10003 in LE = next OID to allocate)

database/base/{db}/
├── users.dat
│   ├── Page 0: [page_count=2][reserved]
│   └── Page 1: Empty slotted page (no rows yet)
│
└── indexes/
    └── pk_users_id.idx
        └── Page 0: B-Tree root page (leaf, no keys yet)
```

### Key Observations

1. **OID Persistence**: Every `alloc_oid()` writes immediately to `pg_oid_counter.dat`, ensuring crash-safety.

2. **Cascading Invalidation**: `create_table()` invalidates the database cache, forcing a reload on next access.

3. **Constraint-Index Coupling**: PRIMARY KEY and UNIQUE constraints automatically create backing B-Tree indexes, stored separately in `database/base/{db}/indexes/`.

4. **Variable-Length Encoding**: Names, column types, and expressions use `[u16 len][bytes]` format, enabling variable-length catalog tuples.

5. **Buffer Manager Integration**: All six catalog page operations (pg_table, pg_column, pg_constraint, pg_index) use identical `pin_page`/`unpin_page` semantics.

6. **Lazy Disk Reads**: Catalog tuples are only deserialized when explicitly requested (e.g., `get_table_metadata`). Disk scans happen at access time, not bootstrap.
