---
id: database-doc
title: "Database Doc"
---

# Codebase Structure
- The codebase is organized into two main directories: **frontend** and **backend**.
- All data generated for databases, tables, and tuples is stored in the **database** directory, which is automatically created when the program is executed.
- The **frontend** directory contains all code related to command-line interface (CLI) inputs and outputs.
- The **backend** directory contains the core implementation of the storage manager.

## Overall Layout of the data
All persistent data used and created by the system is stored inside the `database/` directory. This directory serves as the root location for both metadata and table data. The folder structure and path constants defined in `src/backend/layout.rs` specify how databases and tables are organized as directories and files within this location.

### Database Directory Layout
```bash
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
  │   └── catalog.json                # DEPRECATED: Legacy format
  └── base/
      ├── db1/
      │   ├── {table}.dat
      │   └── indexes/
      │       └── {index_name}.idx
      ├── db2/
      │   ├── {table}.dat
      │   └── indexes/
      │       └── {index_name}.idx
```

### Directory Descriptions

- **database/**  
  Root directory for all persistent data used and created by the system.

- **global/**  
  Contains system-wide metadata required to interpret database structure.

- **catalog_pages/**  
  Contains page-based system catalog files. Each file uses the same 8 KB slotted-page format as user tables. See the [Catalog Manager documentation](./projects/catalog-manager/catalog-manager.md) for detailed schema definitions.

- **pg_oid_counter.dat**  
  Stores the next available Object Identifier (OID) as a 4-byte little-endian `u32`. Updated on every DDL operation when the page backend is active.

- **catalog.json**  
  Legacy catalog format (deprecated). Maintained for backward compatibility during migration.

- **base/**  
  Contains one subdirectory per database.

- **`{database}/`**  
  Represents a single database and holds all table files and index files belonging to it.

- **`{table}.dat`**  
  Physical file corresponding to a table, containing both table metadata and tuple data.

- **`indexes/`**  
  Contains B-Tree index files for the parent database. Each index is stored as `{index_name}.idx`.


## Catalog Storage

RookDB supports a **dual-mode** catalog system:

### Page-Based Catalog (Primary)

The primary catalog backend stores metadata in six system catalog files under `database/global/catalog_pages/`. Each file follows the same slotted-page layout as user tables (8 KB pages with header, item ID array, and tuple data).

The six system catalogs are:

| Catalog | File | Contents |
|---------|------|----------|
| pg_database | `pg_database.dat` | Database metadata (name, owner, encoding, timestamp) |
| pg_table | `pg_table.dat` | Table metadata (name, type, statistics) |
| pg_column | `pg_column.dat` | Column metadata (name, type, position, defaults) |
| pg_constraint | `pg_constraint.dat` | Constraint metadata (PK, FK, UNIQUE, NOT NULL, CHECK) |
| pg_index | `pg_index.dat` | Index metadata (name, type, columns, uniqueness) |
| pg_type | `pg_type.dat` | Data type metadata (10 built-in types) |

All catalog I/O is routed through the Buffer Manager for efficient caching.

For complete schema definitions, see the [System Catalogs](./projects/catalog-manager/system-catalogs.md) page.

### Legacy JSON Catalog (Deprecated)

The legacy format is a single JSON file at `database/global/catalog.json`:

```json
{
  "databases": {
    "<database_name>": {
      "tables": {
        "<table_name>": {
          "columns": [
            {
              "name": "<column_name>",
              "data_type": "<data_type>"
            }
          ]
        }
      }
    }
  }
}
```

This format is retained for backward compatibility but is no longer the primary storage backend. On a fresh install, the system bootstraps directly into page-based mode.


## Table File Structure

Each `{table}.dat` file stores table data as a contiguous sequence of bytes and is divided into fixed-size pages. Each page is 8 KB in size.

The first page of the file is reserved as the **Table Header**. Within this page, only the first 4 bytes are used to store the total number of pages that contain tuple data. The remaining bytes in the header page are currently unused.

All subsequent pages are data pages used to store tuples.

### Page Structure

The page structure is based on the PostgreSQL slotted-page layout, with only the minimum required metadata implemented.

For reference, the PostgreSQL page layout is described at:  
https://www.postgresql.org/docs/current/storage-page-layout.html#STORAGE-PAGE-LAYOUT-FIGURE

Each data page is divided into:
- A **page header**, which stores the `lower` and `upper` offsets
- An **Item ID array**, growing forward from the page header
- **Tuple data**, appended from the end of the page backward

The page-related implementation is located in `src/backend/page/mod.rs`.