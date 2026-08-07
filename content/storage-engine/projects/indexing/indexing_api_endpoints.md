---
title: API Endpoints
sidebar_position: 13
---

## 1. Module Import Map

The crate root re-exports backend modules, so callers can use these paths directly:

- `storage_manager::catalog::*` for catalog metadata operations
- `storage_manager::index::*` for index build, load, search, rebuild, validation, and maintenance helpers
- `storage_manager::executor::{index_scan, index_scan_by_column}` for tuple fetch via index
- `storage_manager::heap::{insert_tuple_with_index_maintenance, delete_tuple_with_index_maintenance}` for write path maintenance

## 2. Core Data Contracts

### `IndexAlgorithm`

Supported values:

- `StaticHash`
- `ChainedHash`
- `ExtendibleHash`
- `LinearHash`
- `BTree`
- `BPlusTree`
- `RadixTree`
- `SkipList`
- `LsmTree`

Helpers:

- `is_hash()` and `is_tree()`
- `from_str(...)` supports aliases like `btree`, `bplus_tree`, `linear_hash`, etc.

### `IndexEntry`

Catalog metadata for an index:

- `index_name: String`
- `column_name: Vec<String>` (single or composite)
- `algorithm: IndexAlgorithm`
- `is_clustered: bool`
- `include_columns: Vec<String>`

Useful helper:

- `is_secondary()` is `!is_clustered`

### `IndexKey` and `RecordId`

- `IndexKey` variants: `Int(i64)`, `Float(f64)`, `Text(String)`
- `RecordId`: `{ page_no: u32, item_id: u32 }`

## 3. Catalog-Level Index Endpoints (Metadata)

These APIs register/remove index metadata in catalog and persist `catalog.json`.

### `create_index`

```rust
pub fn create_index(
    catalog: &mut Catalog,
    db_name: &str,
    table_name: &str,
    index_name: &str,
    column_names: &[String],
    algorithm: IndexAlgorithm,
    is_clustered: bool,
    include_columns: Vec<String>,
) -> bool
```

Behavior:

- Validates DB/table existence
- Validates indexed and include columns
- Prevents duplicate index names per table
- Enforces max one clustered index per table
- Appends `IndexEntry` and saves catalog

Important:

- This does **not** build or save an `.idx` file. Build step must be called separately.

### `create_secondary_index`

```rust
pub fn create_secondary_index(
    catalog: &mut Catalog,
    db_name: &str,
    table_name: &str,
    index_name: &str,
    column_names: &[String],
    algorithm: IndexAlgorithm,
) -> io::Result<()>
```

Behavior:

- Wrapper over `create_index(..., is_clustered = false, include_columns = vec![])`

### `drop_index`

```rust
pub fn drop_index(
    catalog: &mut Catalog,
    db_name: &str,
    table_name: &str,
    index_name: &str,
) -> bool
```

Behavior:

- Removes index metadata entry from table and saves catalog

Important:

- Does **not** delete index file from disk; remove `.idx` manually if desired.

### `drop_secondary_index`

```rust
pub fn drop_secondary_index(
    catalog: &mut Catalog,
    db_name: &str,
    table_name: &str,
    index_name: &str,
) -> io::Result<()>
```

Behavior:

- Ensures index exists and is non-clustered
- Delegates metadata removal to `drop_index`

Important:

- Also does **not** delete index file from disk.

### Listing/lookup helpers

```rust
pub fn list_indexes<'a>(
    catalog: &'a Catalog,
    db_name: &str,
    table_name: &str,
) -> Option<&'a Vec<IndexEntry>>

pub fn list_secondary_indices(
    catalog: &Catalog,
    db_name: &str,
    table_name: &str,
) -> io::Result<Vec<IndexEntry>>
```

### Catalog I/O used by integrations

```rust
pub fn load_catalog() -> Catalog
pub fn save_catalog(catalog: &Catalog)
```

## 4. Index Build, Persistence, and Lookup Endpoints

### `AnyIndex` constructors/loaders

```rust
pub fn new_empty(algorithm: &IndexAlgorithm) -> AnyIndex
pub fn new_default(family: &str) -> AnyIndex
pub fn load(path: &str, algorithm: &IndexAlgorithm) -> io::Result<AnyIndex>
```

### Build from existing table data

```rust
pub fn build_from_table(
    catalog: &Catalog,
    db_name: &str,
    table_name: &str,
    column_name: &str,
    algorithm: &IndexAlgorithm,
) -> io::Result<AnyIndex>

pub fn build_from_table_columns(
    catalog: &Catalog,
    db_name: &str,
    table_name: &str,
    column_names: &[String],
    algorithm: &IndexAlgorithm,
) -> io::Result<AnyIndex>

pub fn build_secondary_index(
    catalog: &Catalog,
    db_name: &str,
    table_name: &str,
    index_entry: &IndexEntry,
) -> io::Result<AnyIndex>
```

Notes:

- Supports composite index keys using `column_names`
- Reads tuple bytes from table pages and extracts key(s)
- Key extraction supports `INT`, `TEXT`, `BOOL/BOOLEAN`

### Runtime index operations

```rust
pub fn insert(&mut self, key: IndexKey, record_id: RecordId) -> io::Result<()>
pub fn search(&self, key: &IndexKey) -> io::Result<Vec<RecordId>>
pub fn delete(&mut self, key: &IndexKey, record_id: &RecordId) -> io::Result<bool>
pub fn save(&self, path: &str) -> io::Result<()>
```

### On-disk point search (without fully materializing index in caller)

```rust
pub fn search_on_disk(
    path: &str,
    algorithm: &IndexAlgorithm,
    key: &IndexKey,
) -> io::Result<Vec<RecordId>>
```

Implementation detail:

- `BPlusTree` uses dedicated on-disk traversal
- Other algorithms use paged-store search path

### Tree-only range scan

```rust
pub fn range_scan(&self, start: &IndexKey, end: &IndexKey) -> io::Result<Vec<RecordId>>
pub fn supports_range_scan(&self) -> bool
```

- Hash indexes return `Unsupported` for range scan

## 5. Path and Key Utility Endpoints

### Key conversion for lookup inputs

```rust
pub fn index_key_from_values(
    columns: &[Column],
    index_columns: &[String],
    values: &[String],
) -> io::Result<IndexKey>
```

Use this for all user/API-provided search keys, especially composite indexes.

Important composite-key note:

- Multi-column keys are encoded into a sortable hex string and represented as `IndexKey::Text(...)`
- Do not handcraft composite keys; use this helper to avoid ordering/encoding mismatch

### Canonical index file paths

```rust
pub fn index_file_path(db_name: &str, table_name: &str, index_name: &str) -> String
pub fn secondary_index_file_path(db_name: &str, table_name: &str, index_name: &str) -> String
```

Current behavior:

- Both helpers resolve to the same path shape: `database/base/{db}/{table}_{index}.idx`

## 6. Rebuild, Validation, and Layout Endpoints

### Rebuild APIs

```rust
pub fn rebuild_table_indexes(catalog: &Catalog, db_name: &str, table_name: &str) -> io::Result<usize>
pub fn rebuild_secondary_index(
    catalog: &Catalog,
    db_name: &str,
    table_name: &str,
    index_name: &str,
) -> io::Result<()>
```

- `rebuild_table_indexes` rebuilds every registered index on the table
- `rebuild_secondary_index` refuses clustered indexes

### Consistency validation APIs

```rust
pub fn validate_index_consistency(
    catalog: &Catalog,
    db_name: &str,
    table_name: &str,
    index_name: &str,
) -> io::Result<()>

pub fn validate_all_table_indexes(
    catalog: &Catalog,
    db_name: &str,
    table_name: &str,
) -> io::Result<usize>
```

Validation checks:

- Algorithm structure invariants via `validate_structure()`
- Full tuple scan vs index entries
- Missing/stale entries and entry-count mismatch

### Clustered physical layout API

```rust
pub fn maintain_clustered_index_layout(
    catalog: &Catalog,
    db_name: &str,
    table_name: &str,
) -> io::Result<bool>

pub fn cluster_table_by_index(
    catalog: &Catalog,
    db_name: &str,
    table_name: &str,
    index_name: &str,
) -> io::Result<()>
```

- `maintain_clustered_index_layout` auto-detects clustered index and reorders table if present
- `cluster_table_by_index` rewrites table file in key order, then rebuilds all indexes

## 7. Write-Path Maintenance Endpoints

### Low-level index maintenance helpers

```rust
pub fn add_tuple_to_all_indexes(
    catalog: &Catalog,
    db_name: &str,
    table_name: &str,
    tuple: &[u8],
    record_id: RecordId,
) -> io::Result<usize>

pub fn remove_tuple_from_all_indexes(
    catalog: &Catalog,
    db_name: &str,
    table_name: &str,
    tuple: &[u8],
    record_id: RecordId,
) -> io::Result<usize>
```

### Preferred heap APIs for inserts/deletes with index sync

```rust
pub fn insert_tuple_with_index_maintenance(
    catalog: &Catalog,
    db_name: &str,
    table_name: &str,
    file: &mut File,
    data: &[u8],
) -> io::Result<RecordId>

pub fn delete_tuple_with_index_maintenance(
    catalog: &Catalog,
    db_name: &str,
    table_name: &str,
    file: &mut File,
    record_id: RecordId,
) -> io::Result<()>
```

These call the heap operation and index maintenance in one place.

## 8. Query Endpoints Returning Tuples

```rust
pub fn index_scan(
    catalog: &Catalog,
    db_name: &str,
    table_name: &str,
    index_name: &str,
    key: &IndexKey,
) -> io::Result<Vec<Vec<u8>>>

pub fn index_scan_by_column(
    catalog: &Catalog,
    db_name: &str,
    table_name: &str,
    column_name: &str,
    key: &IndexKey,
) -> io::Result<Vec<Vec<u8>>>
```

Behavior:

- Uses catalog metadata to resolve algorithm and index file path
- Probes index via `AnyIndex::search_on_disk`
- Fetches tuples by `RecordId`
- Prefers clustered index when multiple indexes exist on same column (`index_scan_by_column`)

## 9. Integration Playbooks

### A. Create and build a new index

1. Load catalog with `load_catalog()`
2. Register metadata using `create_index(...)` or `create_secondary_index(...)`
3. Build using `AnyIndex::build_from_table_columns(...)`
4. Persist with `idx.save(index_file_path(...))`
5. If clustered, call `cluster_table_by_index(...)`

### B. Bulk load then restore index correctness

1. Load data into heap pages
2. Call `rebuild_table_indexes(...)`
3. Call `maintain_clustered_index_layout(...)`

This is the same post-load pattern used by CSV load paths.

### C. OLTP insert/delete with automatic index updates

- Use `insert_tuple_with_index_maintenance(...)` for inserts
- Use `delete_tuple_with_index_maintenance(...)` for deletes

### D. Drop an index cleanly

1. Remove catalog metadata with `drop_index(...)` or `drop_secondary_index(...)`
2. Delete `.idx` file on disk using `std::fs::remove_file(...)`

## 10. Practical Caveats for Cross-Team Integration

- Metadata registration and physical index build are intentionally separate steps.
- `include_columns` is stored in catalog metadata, but there is currently no dedicated covering-index read path.
- Composite index lookup should always use `index_key_from_values(...)`.
- If you bypass heap maintenance wrappers during writes, schedule explicit rebuild/validation.
- For post-integration checks, use `validate_index_consistency(...)` or `validate_all_table_indexes(...)` in tests or startup health checks.
