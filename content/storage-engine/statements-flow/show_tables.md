---
id: show_tables
title: "Show Tables"
---
### **Show Tables**

**Description:**  
Displays all tables present in the currently selected database by reading table metadata from the in-memory catalog.

**Function:**  
```rust
pub fn show_tables(
    catalog: &Catalog,
    db_name: &str,
)
```

**Input:**
- `catalog` — Read-only reference to the in-memory catalog containing database and table metadata.
- `db_name` — Name of the database whose tables should be displayed.

**Output:**
- No return value (`()`).
- Prints all table names in the specified database.
- Prints an appropriate message if the database does not exist or contains no tables.

**Implementation:**
1. Validate that the specified database exists in the catalog.
2. If the database does not exist:
   - Print an error message.
   - Return immediately.
3. Retrieve the database metadata from:
   ```rust
   catalog.databases
   ```
4. Check whether the database contains any tables.
5. If no tables exist:
   - Print:
     ```
     No tables found.
     ```
   - Return immediately.
6. Iterate through all table names stored in:
   ```rust
   database.tables
   ```
7. Print each table name to the console.
8. Log the displayed table information.

**Internal API Calls:**
- `catalog.databases.get(db_name)`
  - Retrieves the database metadata from the catalog.

- `database.tables.is_empty()`
  - Checks whether the selected database contains any tables.

- `database.tables.keys()`
  - Retrieves all table names stored in the database metadata.

- `println!(...)`
  - Displays table names and status messages.

- `log::info!(...)`
  - Records informational messages in the log.

- `log::debug!(...)`
  - Records debug information in the log.

**Files Created/Modified:**
- None.

**Catalog Updates:**
- None.
- The function only reads metadata from the catalog.

**Notes:**
- Table names are retrieved entirely from the in-memory catalog.
- No table files are opened or scanned during this operation.
- The function is read-only and does not modify database state.