---
title: Implementation Notes
sidebar_position: 6
---

# Catalog Manager — Implementation Notes

This page documents design decisions and corrections that emerged during implementation and are **not present in the original design document** (`CatalogManager.txt`). Each entry explains what the original document left unspecified or incorrect, and how it was resolved.

---

## 1. Catalog File Header Must Be a Full 8,192-Byte Page

### Problem

The original document stated:

> *page 0 – table header (first 4 bytes = total page count)*

It did not specify the byte length of page 0. The disk manager computes page offsets as:

```
offset = page_num × PAGE_SIZE   (PAGE_SIZE = 8,192)
```

If page 0 were written as fewer than 8,192 bytes, every subsequent `read_page` call would seek to an out-of-bounds offset, causing `UnexpectedEof` on every catalog scan. The entire page backend would silently return empty results.

### Resolution

Catalog files use the **identical layout as user-table files**: page 0 is a full 8,192-byte header page (first 4 bytes = page count), followed by an 8,192-byte empty slotted data page.

`CatalogPageManager::create_catalog_file` delegates to `init_table()`, the same function used for user tables, instead of writing a custom short header.

---

## 2. Removed `CatalogBuffer` — Page Caching Delegated to `CatalogCache`

### Problem

The original document specified `CatalogPageManager` as containing a `BufferManager` and `catalog_file_paths`. The initial implementation added a private `CatalogBuffer` struct and `buffers: HashMap<String, CatalogBuffer>` inside `CatalogPageManager` as a stub for a per-catalog page buffer. This field was never populated — every CRUD method opened the file directly — making it pure dead code.

### Resolution

`CatalogPageManager` holds **only file-path mappings**. In-memory caching of catalog entries is the exclusive responsibility of `CatalogCache` (`catalog/cache.rs`), which provides LRU eviction over complete deserialized entries. Duplicating a raw page cache inside the page manager would introduce a second, inconsistent view of the same data.

`CatalogBuffer` struct and the `buffers` field were removed entirely.

---

## 3. `update_catalog_tuple` Uses Delete-Then-Reinsert

### Problem

The original document described:

> *`update_catalog_tuple` – fetch page, update tuple, mark page dirty*

It did not address variable-length catalog tuples. A naive in-place overwrite only works when the serialised length of the new data is identical to the old data. Because all six system catalogs store variable-length strings (names, expressions, owner fields), the length can and does change.

### Resolution

`update_catalog_tuple` employs a **delete-then-reinsert** strategy:

1. **Logical delete**: Zero the slot's length field in the slot directory.
2. **Reinsert**: Append the new tuple via `insert_catalog_tuple`, exactly as a fresh insert.

The method returns `(new_page_num, new_slot_id)` so callers can update any cached location.

### Signature Change

```diff
-fn update_catalog_tuple(catalog_name, page_num, slot_id, new_data) -> Result<()>
+fn update_catalog_tuple(catalog_name, page_num, slot_id, new_data) -> Result<(u32, u32)>
```

### Tradeoffs

- Leaves gaps (logically deleted slots) in pages; a future `vacuum_catalog` operation could compact them.
- Stale `(page, slot)` pairs remain readable but their length field is zero, so `scan_catalog` skips them correctly.

---

## 4. `insert_catalog_tuple` Returns the Exact Slot Index

### Problem

The original document stated `insert_catalog_tuple` returns `(page_num, slot_id)`. The initial implementation returned `(total_pages - 1, 0)` — hardcoding the slot to `0`, which is always the *first* slot on the page, not the one just written.

If a caller used this return value for a subsequent `delete_catalog_tuple` or `read_catalog_tuple`, it would operate on the wrong tuple.

### Resolution

After `insert_tuple` returns, re-read the page's `lower` pointer (which has already been advanced) and compute the exact slot:

```rust
slot_id = (lower - PAGE_HEADER_SIZE) / ITEM_ID_SIZE - 1
```

This is correct because `insert_tuple` appends slots left-to-right: the slot just written is always the last one (`num_slots - 1`).

---

## 5. `Catalog::alloc_oid` Persists the Counter When the Page Backend Is Active

### Problem

The original document showed OID allocation through `OidCounter::allocate_oid`, which calls `persist_counter()` on every allocation. The `Catalog` struct held a plain `oid_counter: u32` field used by `Catalog::alloc_oid()` for convenience. This in-memory increment was never written back to `pg_oid_counter.dat`.

**Consequence:** After any DDL session, the counter file retained the value from the previous restart (`USER_OID_START = 10,000`). On next start, `load_catalog_from_pages` would restore the counter from the file, resetting it to 10,000 and causing every new object to receive a colliding OID.

### Resolution

`Catalog::alloc_oid` writes the incremented `next_oid` directly to `OID_COUNTER_FILE` whenever `page_backend_active == true`. In legacy JSON mode the counter is captured implicitly inside `catalog.json` and this write is skipped.

```rust
pub fn alloc_oid(&mut self) -> u32 {
    let oid = self.oid_counter;
    self.oid_counter += 1;
    if self.page_backend_active {
        // Write self.oid_counter to pg_oid_counter.dat at offset 0
    }
    oid
}
```

---

## 6. `drop_index` Used Fabricated Page Coordinates

### Problem

The original `drop_index` loop tracked a `page_num_acc` variable initialised to `1` and never incremented. The slot was taken from `i`, the position in the `scan_catalog` result `Vec`, which is unrelated to the actual slot number on the storage page. Calling `delete_catalog_tuple` with these fabricated coordinates would zero a random unrelated slot.

### Resolution

Replaced the manual scan with `pm.find_catalog_tuple(CAT_INDEX, |b| ...)`. The page manager returns the real `(page_num, slot_id, raw_bytes)` tuple. The index metadata is deserialized from `raw_bytes` (avoids a second scan), and the correct coordinates are passed to `delete_catalog_tuple`.

---

## 7. `CatalogCache` Was Implemented but Never Wired In

### Problem

`cache.rs` implemented a fully functional LRU cache (`CatalogCache`) but the `Catalog` struct had no `cache` field, so the cache was never allocated and `invalidate_*` / `insert_*` were never called.

### Resolution

1. Added `#[derive(Debug)]` to `CatalogCache` (required by `Catalog`'s `Debug` derive).
2. Added `pub fn default_instance() -> Self { Self::new(256) }` to `CatalogCache`.
3. Added `cache: CatalogCache` field to the `Catalog` struct with `#[serde(skip, default = "CatalogCache::default_instance")]`.
4. Added `catalog.cache.invalidate_*` calls at every DDL mutation point:

| Function | File | Invalidation |
|----------|------|-------------|
| `create_database` | `catalog.rs` | `invalidate_database(db_name)` |
| `drop_database` | `catalog.rs` | `invalidate_database(db_name)` |
| `create_table` | `catalog.rs` | `invalidate_table(db_oid, table_name)` |
| `drop_table` | `catalog.rs` | `invalidate_table`, `invalidate_constraints`, `invalidate_indexes` |
| `alter_table_add_column` | `catalog.rs` | `invalidate_constraints(table_oid)` |
| `add_primary_key_constraint` | `constraints.rs` | `invalidate_constraints(table_oid)` |
| `add_foreign_key_constraint` | `constraints.rs` | `invalidate_constraints(table_oid)` |
| `add_unique_constraint` | `constraints.rs` | `invalidate_constraints(table_oid)` |
| `add_not_null_constraint` | `constraints.rs` | `invalidate_constraints(table_oid)` |
| `create_index` | `indexes.rs` | `invalidate_indexes(table_oid)` |
| `drop_index` | `indexes.rs` | `invalidate_indexes(index.table_oid)` |

---

## Summary of Changes

| # | Component | Original Doc | Issue | Fix |
|---|-----------|-------------|-------|-----|
| 1 | `page_manager.rs` | page 0 = header | 8-byte header vs 8,192-byte page breaks seeks | Delegate to `init_table()` |
| 2 | `page_manager.rs` | Use `BufferManager` | Dead `CatalogBuffer` stub | Removed; caching via `CatalogCache` |
| 3 | `page_manager.rs` | Fetch + update in place | Fails on variable-length changes | Delete-then-reinsert; returns new `(page, slot)` |
| 4 | `page_manager.rs` | Returns `(page_num, slot_id)` | Slot hardcoded to 0 | Compute from `lower` pointer after insert |
| 5 | `types.rs` | Use `OidCounter` | Counter never persisted | Write to `pg_oid_counter.dat` when `page_backend_active` |
| 6 | `indexes.rs` | Delete at stored coordinates | Fabricated `(page, slot)` values | Use `find_catalog_tuple` for real coordinates |
| 7 | `cache.rs` | Wired into `Catalog` | Never instantiated or called | Added field, constructor, and invalidation calls |
