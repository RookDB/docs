---
title: Buffer Manager
sidebar_position: 3
---

# Buffer Manager


The **Buffer Pool** is responsible for managing in-memory pages for multiple tables (files). It acts as an abstraction layer between disk storage and higher-level components such as the catalog and table manager.

It supports:
- Multi-file page management
- Page caching (hit/miss handling)
- Replacement policies (LRU, Clock, etc.)
- Dirty page handling and flushing
- Reserved memory region for catalog pages

---

# Core Concepts

- **PageId** → uniquely identifies a page:
  (table_name, page_number)

- **Frames** → fixed-size memory slots storing pages

- **Reserved Frames (0–127)** → used for catalog pages (never evicted)

- **Data Frames (128+)** → used for table data (managed by replacement policy)

---

# Exposed APIs

---

## 1. fetch_page

```rust
pub fn fetch_page(
    &mut self,
    table_name: String,
    page_number: u32,
) -> io::Result<&mut Page>
```

### Description
Fetches a page from the buffer pool. If the page is not present, it is loaded from disk.

### Inputs

| Parameter | Type | Description |
|----------|------|-------------|
| table_name | String | Name of the table (file) |
| page_number | u32 | Page number to fetch |

### Output

| Return Type | Description |
|------------|-------------|
| Ok(&mut Page) | Mutable reference to the page |
| Err(io::Error) | If page cannot be loaded |

### Behavior

1. Buffer Hit
   - Page found in page_table
   - Increments pin_count and usage_count
   - Updates replacement policy (if not reserved)

2. Buffer Miss
   - Searches for free frame
   - If none, evicts a victim frame
   - Flushes dirty page if needed

3. Disk Load
   - Reads page from correct file using table_name
   - Inserts into buffer and updates metadata

### Notes
- Requires file to be registered in self.files
- Reserved frames are never evicted

---

## 2. unpin_page

```rust
pub fn unpin_page(
    &mut self,
    page_id: &PageId,
    is_dirty: bool,
) -> io::Result<()>
```

### Description
Releases a previously pinned page and optionally marks it as dirty.

### Inputs

| Parameter | Type | Description |
|----------|------|-------------|
| page_id | &PageId | Page identifier |
| is_dirty | bool | Whether the page was modified |

### Output

| Return Type | Description |
|------------|-------------|
| Ok(()) | Success |
| Err(io::Error) | If page not found or already unpinned |

### Behavior

- Decrements pin_count
- Marks page as dirty if is_dirty = true

### Notes
- Page cannot be evicted while pinned

---

## 3. flush_page

```rust
pub fn flush_page(&mut self, page_id: &PageId) -> io::Result<()>
```

### Description
Writes a dirty page from buffer to disk.

### Inputs

| Parameter | Type | Description |
|----------|------|-------------|
| page_id | &PageId | Page to flush |

### Output

| Return Type | Description |
|------------|-------------|
| Ok(()) | Success |
| Err(io::Error) | If page not found |

### Behavior

- Writes page to correct file using table_name
- Clears dirty flag
- Updates stats

---

## 4. flush_all_pages

```rust
pub fn flush_all_pages(&mut self) -> io::Result<()>
```

### Description
Flushes all dirty pages in the buffer pool to disk.

### Inputs
None

### Output

| Return Type | Description |
|------------|-------------|
| Ok(()) | Success |
| Err(io::Error) | On write failure |

### Behavior

- Iterates over all frames
- Writes all dirty pages to disk

---

## 5. new_page

```rust
pub fn new_page(
    &mut self,
    table_name: String,
) -> io::Result<(PageId, &mut Page)>
```

### Description
Creates a new page in a table file and loads it into the buffer.

### Inputs

| Parameter | Type | Description |
|----------|------|-------------|
| table_name | String | Target table |

### Output

| Return Type | Description |
|------------|-------------|
| (PageId, &mut Page) | New page identifier and reference |
| Err(io::Error) | If creation fails |

### Behavior

1. Calls create_page() on disk  
2. Fetches new page into buffer  
3. Marks page as dirty  

---

## 6. delete_page

```rust
pub fn delete_page(&mut self, page_id: &PageId) -> io::Result<()>
```

### Description
Removes a page from the buffer pool.

### Inputs

| Parameter | Type | Description |
|----------|------|-------------|
| page_id | &PageId | Page to delete |

### Output

| Return Type | Description |
|------------|-------------|
| Ok(()) | Success |
| Err(io::Error) | If page is pinned |

### Behavior

- Removes mapping from page_table  
- Clears frame metadata  

### Notes
- Does not delete from disk  

---

## 7. reset

```rust
pub fn reset(&mut self)
```

### Description
Clears the entire buffer pool state.

### Behavior

- Clears all frames  
- Clears page_table  
- Clears files  
- Resets statistics  

---

## 8. preload_database

```rust
pub fn preload_database(&mut self, db_name: &str) -> io::Result<()>
```

### Description
Loads all table pages of a database into the buffer pool.

### Inputs

| Parameter | Type | Description |
|----------|------|-------------|
| db_name | &str | Database name |

### Output

| Return Type | Description |
|------------|-------------|
| Ok(()) | Success |
| Err(io::Error) | On failure |

### Behavior

- Resets buffer pool  
- Iterates over all table files  
- Loads pages starting from frame 128  
- Stops when buffer is full  

---

## 9. preload_catalog_pages

```rust
pub fn preload_catalog_pages(&mut self) -> io::Result<()>
```

### Description
Loads the first two pages of each system catalog file into reserved frames.

### Behavior

- Opens catalog files:
  - pg_database
  - pg_table
  - pg_column
  - pg_constraint
  - pg_index
  - pg_type  
- Loads pages 0 and 1  
- Stores them in reserved frames (0–127)  
- Registers files in self.files  

### Notes

- These pages are:
  - Never evicted  
  - Not part of replacement policy  

---

# Summary

The Buffer Pool now supports:

- Multi-file page management  
- Page-level caching  
- Catalog + data separation  
- Replacement policies  
- Dirty page handling  
- Preloading strategies  

---

# Example Usage

```rust
let mut bp = BufferPool::new(Box::new(LRU::new()));

bp.preload_catalog_pages()?;      // load system catalogs
bp.preload_database("users")?;    // load table data

let page = bp.fetch_page("students".to_string(), 1)?;
bp.unpin_page(&PageId { table_name: "students".into(), page_number: 1 }, false)?;
```