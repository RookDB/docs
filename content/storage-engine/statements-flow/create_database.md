---
id: create_database
title: "Create Database"
---
### **Create Database**

**Description:**  
Creates a new database entry in the catalog, persists the updated catalog to disk, and creates the corresponding database directory under `database/base/`.

**Function:**  
```rust
pub fn create_database(
    catalog: &mut Catalog,
    db_name: &str,
) -> bool
```

**Input:**
- `catalog` — In-memory catalog containing all database metadata.
- `db_name` — Name of the database to create. Must be non-empty and unique.

**Output:**
- Returns `true` if the database was successfully created.
- Returns `false` if validation, catalog persistence, or directory creation fails.

**Implementation:**
1. Validate that `db_name` is not empty.
2. Check whether a database with the same name already exists in the catalog.
3. Create a new `Database` object with an empty table map.
4. Insert the database into `catalog.databases`.
5. Serialize the entire catalog to JSON using `serde_json`.
6. Persist the catalog to the catalog file (`catalog.json`).
7. Create the database directory:
   ```
   database/base/{db_name}/
   ```
   if it does not already exist.
8. Return `true` on success; otherwise return `false` if any validation, serialization, file write, or directory creation step fails.