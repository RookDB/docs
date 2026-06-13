---
id: create_table
title: "Create Table"
---
### **Create Table**

**Description:**  
Creates a new table in an existing database, stores its schema in the catalog, persists catalog changes, creates the table file on disk, and initializes the table storage structure.

**Function:**  
```rust
pub fn create_table(
    catalog: &mut Catalog,
    db_name: &str,
    table_name: &str,
    columns: Vec<Column>,
)
```

**Input:**
- `catalog` — In-memory catalog containing database and table metadata.
- `db_name` — Name of the database in which the table will be created.
- `table_name` — Name of the new table. Must be unique within the database.
- `columns` — Vector containing the table schema definition.

**Output:**
- No return value (`()`).
- Updates the catalog and creates the corresponding table storage file.

**Implementation:**
1. Validate that the specified database exists in the catalog.
2. Check whether a table with the same name already exists in the database.
3. Create a new `Table` structure using the provided column definitions.
4. Insert the table metadata into the database entry within the catalog.
5. Persist the updated catalog to disk.
6. Construct the table file path using:
   ```
   database/base/{database}/{table}.db
   ```
7. Create the table file if it does not already exist.
8. Initialize the table storage layout inside the newly created file.
9. Log and print status messages throughout the process.

**Internal API Calls:**
- `save_catalog(catalog)`
  - Serializes the catalog and persists it to `catalog.json`.
  - Called immediately after inserting table metadata.

- `init_table(&mut file)`
  - Initializes the newly created table file with the required storage structure and metadata pages.
  - Called after the table file is successfully created.

**Files Created/Modified:**
- `catalog.json` (updated via `save_catalog`)
- `database/base/{database}/{table}.db` (created if it does not already exist)

**Catalog Updates:**
- Adds a new entry to:
  ```rust
  catalog.databases[db_name].tables
  ```
- Stores the table schema (`Vec<Column>`) inside the catalog metadata.