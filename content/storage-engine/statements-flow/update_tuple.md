---
id: update_tuple
title: "Update Tuple"
---
### **Update Tuple**

**Description:**  
Updates tuples that satisfy the specified conditions by performing a soft delete on the original tuple and inserting a new updated tuple version through the heap manager.

**Function:**  
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

**Input:**
- `catalog` — Catalog containing database and table metadata.
- `db_name` — Name of the target database.
- `table_name` — Name of the target table.
- `file` — Open table heap file.
- `assignments` — Parsed `SET` clause assignments.
- `condition_groups` — Parsed `WHERE` clause conditions.
- `returning` — Indicates whether updated rows should be returned.

**Output:**
- Returns an `UpdateResult` containing:
  - `updated_count` — Number of tuples updated.
  - `returning_rows` — Updated rows when `RETURNING` is enabled.
- Returns an `io::Error` if the database, table, page operations, or file operations fail.

**Implementation:**
1. Validate that the specified database exists.
2. Validate that the specified table exists.
3. Retrieve the table schema from the catalog.
4. Scan all heap pages in the table file.
5. Read every active tuple from each page.
6. Decode tuple data into column-value pairs.
7. Evaluate the tuple against the provided `WHERE` conditions.
8. For every matching tuple:
   - Apply the `SET` assignments.
   - Encode the updated tuple.
   - Store the update in a pending update list.
9. For each pending update:
   - Acquire a page write lock.
   - Mark the original tuple as deleted using `SLOT_FLAG_DELETED`.
   - Write the updated page back to disk.
   - Clear the corresponding Visibility Map entry.
10. Increment the dead tuple count.
11. Insert each updated tuple as a new tuple through the heap API.
12. Collect updated rows if `RETURNING` is enabled.
13. Generate an update operation log entry.
14. Return the total number of updated tuples and any returned rows.

**Internal API Calls:**
- `page_count(file)`
  - Retrieves the total number of pages in the heap file.

- `file_identity_from_file(file)`
  - Obtains a unique file identifier for page locking.

- `read_page(file, &mut page, page_id)`
  - Reads a heap page from disk.

- `decode_tuple(&tuple_data, columns)`
  - Converts stored tuple bytes into typed column values.

- `matches_condition_groups_pub(...)`
  - Evaluates the tuple against the WHERE clause.

- `apply_assignments(decoded, assignments)`
  - Applies SET clause modifications to the tuple.

- `encode_tuple(&updated_decoded, columns)`
  - Serializes the updated tuple into storage format.

- `PageWriteLock::acquire(...)`
  - Acquires a write lock for safe page modification.

- `write_page(file, &mut page, page_id)`
  - Persists modified page data to disk.

- `vm_clear_page(db_name, table_name, page_id)`
  - Marks the page as containing dead tuples in the Visibility Map.

- `increment_dead_tuple_count(file, count)`
  - Updates dead tuple statistics.

- `heap_api::insert_raw_tuple(db_name, table_name, &new_bytes)`
  - Inserts the updated tuple through the heap manager and FSM.

- `log_update(db_name, table_name, details, status)`
  - Records the update operation in the operation log.

**Files Created/Modified:**
- Table heap file.
- Visibility Map (VM) file.
- Operation log file.

**Storage Updates:**
- Original tuple is soft-deleted by setting:
  ```rust
  SLOT_FLAG_DELETED
  ```
- Updated tuple is inserted as a new tuple version.
- Visibility Map is updated.
- Dead tuple count is incremented.
- Update operation is logged.

**Notes:**
- Updates follow an MVCC-style delete-and-insert approach rather than in-place modification.
- Original tuple data remains on disk but is ignored during future scans.
- New tuple placement is managed by the Heap Manager and Free Space Map (FSM).