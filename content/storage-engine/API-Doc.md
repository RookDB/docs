# API Doc

## Index of APIs

### Core Catalog APIs
0. Init Catalog  
1. Load Catalog  
2. Create Database  
3. Drop Database  
4. Show Databases  
5. Select Database  
6. Show Tables  
7. Create Table  
8. Drop Table  
9. Alter Table Add Column  
10. Get Table Metadata  

### Constraint APIs
11. Add Primary Key Constraint  
12. Add Foreign Key Constraint  
13. Add Unique Constraint  
14. Add Not Null Constraint  
15. Validate Constraints  
16. Get Constraints for Table  

### Index APIs
17. Create Index  
18. Drop Index  

### Type APIs
19. Register Built-in Types  
20. Lookup Type by Name  

### Page / Table / Tuple APIs
21. Init Table  
22. Init Page  
23. Page Count  
24. Create Page  
25. Read Page  
26. Write Page  
27. Page Free Space  
28. Add Tuple to Page  
29. Read Item / Get Tuple  

---

## Core Catalog API Descriptions

### 0. **init_catalog** API

**Description:**  
Dual-mode catalog initialisation called at startup. Detects whether page-based catalog storage exists and bootstraps the system if necessary.

**Function:**  
```rust
pub fn init_catalog(bm: &mut BufferManager)
```

**Input:**
- `bm` — Mutable reference to the buffer manager.

**Implementation:**
1. Create `database/global/` and `database/base/` directories if they do not exist.
2. Check if `database/global/catalog_pages/` exists.
3. If yes, report that the page backend is detected.
4. If no, call `bootstrap_catalog(bm)` to initialise the system catalogs, register built-in types, and create the system database.

---

### 1. **load_catalog** API

**Description:**  
Loads the catalog from the active storage backend. Attempts page-based loading first; falls back to an empty catalog on failure.

**Function:**  
```rust
pub fn load_catalog(bm: &mut BufferManager) -> Catalog
```

**Output:**
- Returns a `Catalog` struct populated with all databases, tables, columns, constraints, and index OIDs.

**Implementation:**
1. If `catalog_pages/` exists, load from pages:
   - Read OID counter from `pg_oid_counter.dat`
   - Scan `pg_database` → populate `catalog.databases`
   - Scan `pg_table` → attach tables to parent databases by `db_oid`
   - Scan `pg_column` → attach columns to tables by `table_oid`, sort by position
   - Scan `pg_constraint` → attach constraints to tables by `table_oid`
   - Scan `pg_index` → attach index OIDs to tables by `table_oid`
2. On any failure, return `Catalog::new()` (empty).

---

### 2. **create_database** API

**Description:**  
Creates a new database with metadata (owner, encoding) and persists it to `pg_database`.

**Function:**  
```rust
pub fn create_database(
    catalog: &mut Catalog,
    pm: &mut CatalogPageManager,
    bm: &mut BufferManager,
    db_name: &str,
    owner: &str,
    encoding: Encoding,
) -> Result<u32, CatalogError>
```

**Input:**
- `catalog` — In-memory catalog metadata.
- `pm` — Catalog page manager for page-based persistence.
- `bm` — Buffer manager for I/O.
- `db_name` — Name of the new database (must be non-empty and unique).
- `owner` — Owner string (e.g., `"default_user"`).
- `encoding` — Character encoding (`Encoding::UTF8` or `Encoding::ASCII`).

**Output:**
- Returns the allocated `db_oid` on success.

**Implementation:**
1. Validate that the name is non-empty and not already in use.
2. Allocate a new OID via `catalog.alloc_oid()`.
3. Create `database/base/{db_name}/` directory.
4. Serialise and insert a record into `pg_database`.
5. Add the `Database` struct to the in-memory catalog.
6. Invalidate the database cache entry.

---

### 3. **drop_database** API

**Description:**  
Drops a database and all its tables, constraints, and indexes.

**Function:**  
```rust
pub fn drop_database(
    catalog: &mut Catalog,
    pm: &mut CatalogPageManager,
    bm: &mut BufferManager,
    db_name: &str,
) -> Result<(), CatalogError>
```

**Implementation:**
1. Resolve `db_oid` from the in-memory catalog.
2. Drop all tables in the database via `drop_table()`.
3. Find and delete the database record from `pg_database`.
4. Remove the database directory from disk.
5. Remove from in-memory catalog and invalidate cache.

---

### 4. **show_databases** API

**Description:**  
Displays all databases from the page-based catalog with additional metadata.

**Function:**  
```rust
pub fn show_databases(catalog: &Catalog, pm: &mut CatalogPageManager, bm: &mut BufferManager)
```

**Output:**
- Prints a formatted table: `Database | Owner | Created At`.
- Data is fetched directly from `pg_database` via `pm.scan_catalog()`.

---

### 5. **show_tables** API

**Description:**  
Displays all user tables in a database from the page-based catalog with statistics.

**Function:**  
```rust
pub fn show_tables(catalog: &Catalog, pm: &mut CatalogPageManager, bm: &mut BufferManager, db_name: &str)
```

**Output:**
- Prints a formatted table: `Table Name | Rows | Pages | Created At`.

---

### 6. **create_table** API

**Description:**  
Creates a new table with columns and constraints, persisting metdata to `pg_table` and `pg_column`.

**Function:**  
```rust
pub fn create_table(
    catalog: &mut Catalog,
    pm: &mut CatalogPageManager,
    bm: &mut BufferManager,
    db_name: &str,
    table_name: &str,
    col_defs: Vec<ColumnDefinition>,
    constraint_defs: Vec<ConstraintDefinition>,
) -> Result<u32, CatalogError>
```

**Input:**
- `col_defs` — Column definitions: name, type name, nullability, default value.
- `constraint_defs` — Constraint definitions (PrimaryKey, ForeignKey, Unique, NotNull).

**Output:**
- Returns the allocated `table_oid` on success.

**Implementation:**
1. Validate the database exists and the table name is unique within it.
2. Allocate `table_oid` and per-column OIDs.
3. Resolve each column's type via `DataType::from_name()`.
4. Serialise and insert column records into `pg_column`.
5. Create and initialise the table data file via `init_table()`.
6. Serialise and insert table record into `pg_table`.
7. Add to in-memory catalog; invalidate cache.
8. Process constraint definitions (PK, FK, UNIQUE, NOT NULL).

---

### 7. **drop_table** API

**Description:**  
Drops a table and all its dependent objects (indexes, constraints).

**Function:**  
```rust
pub fn drop_table(
    catalog: &mut Catalog,
    pm: &mut CatalogPageManager,
    bm: &mut BufferManager,
    table_oid: u32,
) -> Result<(), CatalogError>
```

**Implementation:**
1. Check for FK dependencies from other tables — return `ForeignKeyDependency` error if found.
2. Drop all indexes on this table.
3. Remove the table data file.
4. Delete the record from `pg_table`.
5. Remove from in-memory catalog; invalidate cache entries.

---

### 8. **alter_table_add_column** API

**Description:**  
Adds a new column to an existing table.

**Function:**  
```rust
pub fn alter_table_add_column(
    catalog: &mut Catalog,
    pm: &mut CatalogPageManager,
    bm: &mut BufferManager,
    table_oid: u32,
    col_def: ColumnDefinition,
) -> Result<u32, CatalogError>
```

**Output:**
- Returns the allocated `column_oid`.

**Constraints:**
- If the column is NOT NULL, a default value **must** be provided.
- Column name must not already exist in the table.

---

### 9. **get_table_metadata** API

**Description:**  
Retrieves complete table metadata including resolved columns, constraints, and indexes.

**Function:**  
```rust
pub fn get_table_metadata(
    catalog: &Catalog,
    pm: &CatalogPageManager,
    bm: &mut BufferManager,
    db_name: &str,
    table_name: &str,
) -> Result<TableMetadata, CatalogError>
```

---

## Constraint APIs

For complete constraint API documentation, see the [Catalog Manager API Reference](./projects/catalog-manager/api-reference.md#constraint-management).

### 10. **add_primary_key_constraint** API

```rust
pub fn add_primary_key_constraint(catalog, pm, bm, table_oid, column_names, constraint_name) -> Result<u32, CatalogError>
```
Adds a PK constraint with a backing unique B-Tree index. Sets referenced columns to NOT NULL.

### 11. **add_foreign_key_constraint** API

```rust
pub fn add_foreign_key_constraint(catalog, pm, bm, table_oid, column_names, referenced_table_oid, referenced_column_names, on_delete, on_update, constraint_name) -> Result<u32, CatalogError>
```
Adds an FK constraint. Validates column counts match and referenced columns are covered by PK/UNIQUE.

### 12. **add_unique_constraint** API

```rust
pub fn add_unique_constraint(catalog, pm, bm, table_oid, column_names, constraint_name) -> Result<u32, CatalogError>
```
Adds a UNIQUE constraint with a backing B-Tree index.

### 13. **add_not_null_constraint** API

```rust
pub fn add_not_null_constraint(catalog, pm, bm, table_oid, column_oid) -> Result<(), CatalogError>
```
Sets `is_nullable = false` on the specified column.

### 14. **validate_constraints** API

```rust
pub fn validate_constraints(catalog, pm, bm, table_oid, tuple_values) -> Result<(), ConstraintViolation>
```
Validates all constraints for a tuple before insertion. Returns specific violation errors (NotNull, Unique, ForeignKey).

---

## Index APIs

For complete index API documentation, see the [Catalog Manager API Reference](./projects/catalog-manager/api-reference.md#index-management).

### 15. **create_index** API

```rust
pub fn create_index(catalog, pm, bm, table_oid, column_oids, is_unique, is_primary, index_name) -> Result<u32, CatalogError>
```
Creates a B-Tree index on specified columns. Creates the index `.idx` file and persists metadata to `pg_index`.

### 16. **drop_index** API

```rust
pub fn drop_index(catalog, pm, bm, index_oid) -> Result<(), CatalogError>
```
Drops an index. Cannot drop indexes referenced by PK or UNIQUE constraints.

---

## Page / Table / Tuple APIs

### 17. **init_table** API
**Description:**
Initializes the **Table Header** by writing the first page (8,192 bytes) with `page_count = 1` in the first 4 bytes, followed by an empty data page.

**Function:**  
```rust
pub fn init_table(file: &mut File) -> Result<(), io::Error>
```

**Implementation:**
1. Write an 8,192-byte header page with page count = 1.
2. Write an 8,192-byte empty data page via `create_page`.

---

### 18. **init_page** API
**Description:**
Initializes a page header with lower offset (`PAGE_HEADER_SIZE`) and upper offset (`PAGE_SIZE`).

**Function:**  
```rust
pub fn init_page(page: &mut Page)
```

---

### 19. **page_count** API
**Description:**
Returns the total number of pages in a file by reading the first 4 bytes of page 0.

**Function:**  
```rust
pub fn page_count(file: &mut File) -> u32
```

---

### 20. **create_page** API
**Description:**  
Creates a new data page at the end of a file and increments the page count.

**Function:**  
```rust
pub fn create_page(file: &mut File) -> Result<(), io::Error>
```

---

### 21. **read_page** API
**Description:**  
Reads a page from disk into memory.

**Function:**  
```rust
pub fn read_page(file: &mut File, page: &mut Page, page_num: u32) -> Result<(), io::Error>
```

---

### 22. **write_page** API
**Description:**  
Writes a page from memory to disk.

**Function:**  
```rust
pub fn write_page(file: &mut File, page: &mut Page, page_num: u32) -> Result<(), io::Error>
```

---

### 23. **page_free_space** API
**Description:**  
Calculates free space = `upper - lower`.

**Function:**  
```rust
pub fn page_free_space(page: &Page) -> Result<u32, io::Error>
```

---

### 24. **Add Tuple** API
**Description:**
Adds raw data to a table file using the slotted-page layout.

**Implementation:**
1. Read the last page.
2. Check if free space ≥ data size + `ITEM_ID_SIZE`.
3. If yes: write data at `upper - data.len()`, update pointers, write ItemId.
4. If no: create a new page and insert there.

---

* **Reference**: [Postgres Internals – Page Layouts & Data](https://www.postgresql.org/docs/current/storage-page-layout.html)
> **Note:** Some APIs have undergone implementation changes during development. Refer to the [Catalog Manager Implementation Notes](./projects/catalog-manager/implementation-notes.md) for details on deviations from the original design.