---
id: select_tuples
title: "Select Tuples"
---
### **Select Tuples**

**Description:**  
Retrieves tuples from a table by scanning heap pages, applying optional WHERE clause conditions, and returning matching rows. Supports full table scans and conditional filtering based on table metadata stored in the catalog.

**Function:**  
```rust
pub fn select_tuples(
    catalog: &Catalog,
    db_name: &str,
    table_name: &str,
    selected_columns: &[String],
    condition_groups: &[Vec<Condition>],
) -> io::Result<SelectResult>
```

**Input:**
- `catalog` — Catalog containing database and table metadata.
- `db_name` — Name of the database containing the table.
- `table_name` — Name of the table to query.
- `selected_columns` — Columns to be returned. Can contain `"*"` for all columns.
- `condition_groups` — Parsed WHERE clause conditions.

**Output:**
- Returns a `SelectResult` containing:
  - `columns` — Selected column names.
  - `rows` — Matching tuples.
  - `row_count` — Number of tuples returned.
- Returns an `io::Error` if table access, page reads, or tuple decoding fails.

**Implementation:**
1. Validate that the specified database exists.
2. Validate that the specified table exists.
3. Retrieve the table schema from the catalog.
4. Open the corresponding heap file.
5. Determine the total number of pages in the table.
6. Sequentially scan all heap pages.
7. Read each page from disk.
8. Iterate through all slot entries in the page.
9. Skip tuples marked as deleted.
10. Deserialize tuple data into typed column values.
11. Evaluate the tuple against the supplied WHERE conditions.
12. If the tuple satisfies the conditions:
    - Extract the requested columns.
    - Add the row to the result set.
13. Continue scanning until all pages are processed.
14. Return the collected rows and row count.

**Internal API Calls:**
- `catalog.databases.get(db_name)`
  - Retrieves database metadata.

- `database.tables.get(table_name)`
  - Retrieves table schema metadata.

- `open_table_file(db_name, table_name)`
  - Opens the heap file associated with the table.

- `page_count(file)`
  - Retrieves the total number of pages in the heap file.

- `read_page(file, &mut page, page_id)`
  - Reads a page from disk.

- `decode_tuple(&tuple_data, columns)`
  - Converts tuple bytes into typed values.

- `matches_condition_groups_pub(...)`
  - Evaluates WHERE clause conditions.

- `project_columns(...)`
  - Extracts only the requested columns from a row.

**Files Created/Modified:**
- None.

**Storage Updates:**
- None.
- The operation is read-only.

**Notes:**
- Performs a sequential heap scan across all table pages.
- Tuples marked with `SLOT_FLAG_DELETED` are ignored.
- Supports both `SELECT *` and projection of specific columns.
- WHERE clause filtering is evaluated during the scan.
- Does not modify heap pages, FSM pages, visibility maps, or catalog metadata.