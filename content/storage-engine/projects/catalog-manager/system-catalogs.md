---
title: System Catalogs
sidebar_position: 3
---

# Catalog Manager — System Catalogs

RookDB implements six system catalog tables that store all database metadata. Each catalog is stored as a dedicated `.dat` file in `database/global/catalog_pages/` using the standard slotted-page format.

Catalog tuples are serialised as variable-length byte slices. Variable-length strings use a `[u16 len (LE)] [bytes …]` encoding; arrays use `[u16 count (LE)] [element × count]`.

---

## pg_database — Database Metadata

Stores one record per database in the system.

| Column Name | Data Type | Constraints | Description |
|-------------|-----------|-------------|-------------|
| `db_oid` | UINT32 | PRIMARY KEY | Unique database identifier |
| `db_name` | VARCHAR(64) | UNIQUE, NOT NULL | Database name |
| `db_owner` | VARCHAR(64) | NOT NULL | Database owner |
| `db_created_at` | UINT64 | | Creation timestamp (Unix epoch) |
| `db_encoding` | UINT8 | NOT NULL | Character encoding (1 = UTF-8, 2 = ASCII) |

**Binary layout:**
```
db_oid(4) | db_name(var) | db_owner(var) | created_at(8) | encoding(1)
```

**Example record:** The bootstrap process creates a system database:
```
db_oid = 1, db_name = "system", db_owner = "rookdb", encoding = UTF-8
```

---

## pg_table — Table Metadata

Stores one record per table (both user tables and system catalog tables).

| Column Name | Data Type | Constraints | Description |
|-------------|-----------|-------------|-------------|
| `table_oid` | UINT32 | PRIMARY KEY | Unique table identifier |
| `table_name` | VARCHAR(64) | NOT NULL | Table name |
| `db_oid` | UINT32 | FOREIGN KEY → pg_database | Parent database |
| `table_type` | UINT8 | NOT NULL | Type: 0 = user table, 1 = system catalog |
| `row_count` | UINT64 | | Estimated row count |
| `page_count` | UINT32 | | Number of data pages |
| `created_at` | UINT64 | | Creation timestamp (Unix epoch) |

**Binary layout:**
```
table_oid(4) | table_name(var) | db_oid(4) | table_type(1)
  | row_count(8) | page_count(4) | created_at(8)
```

---

## pg_column — Column Metadata

Stores one record per column across all tables.

| Column Name | Data Type | Constraints | Description |
|-------------|-----------|-------------|-------------|
| `column_oid` | UINT32 | PRIMARY KEY | Unique column identifier |
| `table_oid` | UINT32 | FOREIGN KEY → pg_table | Parent table |
| `column_name` | VARCHAR(64) | NOT NULL | Column name |
| `column_pos` | UINT16 | NOT NULL | Position in table (1-based) |
| `type_oid` | UINT32 | FOREIGN KEY → pg_type | Data type OID |
| `type_length` | INT16 | | Fixed byte length (-1 for variable) |
| `type_align` | UINT8 | | Alignment requirement (bytes) |
| `type_category` | UINT8 | | Category (1=numeric, 2=string, 3=datetime, 4=boolean, 5=binary) |
| `type_name` | VARCHAR(32) | | Type name string |
| `type_mod_flag` | UINT8 | | Type modifier: 0=none, 1=varchar len, 2=precision |
| `type_mod_data` | variable | | Modifier payload (if flag > 0) |
| `is_nullable` | BOOL | NOT NULL | NULL allowed (true/false) |
| `has_default` | BOOL | | Whether a default value is defined |
| `default_data` | variable | | Serialised default value (if present) |
| `constraint_oids` | UINT32[] | | Array of constraint OIDs for this column |

**Binary layout:**
```
column_oid(4) | table_oid(4) | column_name(var) | column_pos(2)
  | type_oid(4) | type_length(2) | type_align(1) | type_category(1)
  | type_name(var) | type_mod_flag(1) [type_mod_data]
  | is_nullable(1) | has_default(1) [default_tag(1) default_data]
  | num_constraints(2) | constraint_oid[*]
```

### Default Value Tags

| Tag | Type | Payload |
|-----|------|---------|
| 1 | Integer | 4 bytes (i32 LE) |
| 2 | BigInt | 8 bytes (i64 LE) |
| 3 | Float | 4 bytes (f32 LE) |
| 4 | Double | 8 bytes (f64 LE) |
| 5 | String | variable-length string |
| 6 | Boolean | 1 byte |
| 7 | Null | 0 bytes |
| 8 | CurrentTimestamp | 0 bytes |

---

## pg_constraint — Constraint Metadata

Stores one record per constraint.

| Column Name | Data Type | Constraints | Description |
|-------------|-----------|-------------|-------------|
| `constraint_oid` | UINT32 | PRIMARY KEY | Unique constraint identifier |
| `constraint_name` | VARCHAR(64) | NOT NULL | Constraint name |
| `constraint_type` | UINT8 | NOT NULL | Type: 1=PK, 2=FK, 3=UNIQUE, 4=NOT NULL, 5=CHECK |
| `table_oid` | UINT32 | FOREIGN KEY → pg_table | Constrained table |
| `column_oids` | UINT32[] | | Array of constrained column OIDs |
| `is_deferrable` | BOOL | | Deferrable constraint (future) |

**Type-specific metadata** (appended after the base fields):

### Primary Key
| Field | Type | Description |
|-------|------|-------------|
| `index_oid` | UINT32 | OID of the backing unique index |

### Foreign Key
| Field | Type | Description |
|-------|------|-------------|
| `referenced_table_oid` | UINT32 | Referenced table OID |
| `referenced_column_oids` | UINT32[] | Referenced column OIDs |
| `on_delete` | UINT8 | Action: 0=NO ACTION, 1=CASCADE, 2=SET NULL, 3=RESTRICT |
| `on_update` | UINT8 | Action: 0=NO ACTION, 1=CASCADE, 2=SET NULL, 3=RESTRICT |

### Unique
| Field | Type | Description |
|-------|------|-------------|
| `index_oid` | UINT32 | OID of the backing unique index |

### NOT NULL
No additional metadata.

### Check
| Field | Type | Description |
|-------|------|-------------|
| `check_expression` | VARCHAR(256) | SQL expression string |

**Binary layout:**
```
constraint_oid(4) | constraint_name(var) | constraint_type(1)
  | table_oid(4) | column_oids(var array) | is_deferrable(1)
  | <type-specific payload>
```

---

## pg_index — Index Metadata

Stores one record per index.

| Column Name | Data Type | Constraints | Description |
|-------------|-----------|-------------|-------------|
| `index_oid` | UINT32 | PRIMARY KEY | Unique index identifier |
| `index_name` | VARCHAR(64) | NOT NULL | Index name |
| `table_oid` | UINT32 | FOREIGN KEY → pg_table | Indexed table |
| `index_type` | UINT8 | NOT NULL | Type: 1=B-Tree, 2=Hash (future) |
| `column_oids` | UINT32[] | NOT NULL | Indexed column OIDs |
| `is_unique` | BOOL | NOT NULL | Unique index flag |
| `is_primary` | BOOL | NOT NULL | Primary key index flag |
| `index_pages` | UINT32 | | Number of index pages |

**Binary layout:**
```
index_oid(4) | index_name(var) | table_oid(4) | index_type(1)
  | column_oids(var array) | is_unique(1) | is_primary(1) | index_pages(4)
```

### Index File Storage

Each index is stored as a separate B-Tree file at:
```
database/base/{database}/indexes/{index_name}.idx
```

The B-Tree page layout:
- **Byte 0:** Node type (1 = leaf, 0 = internal)
- **Bytes 1–2:** Number of keys (u16 LE)
- **Bytes 3–4:** Lower pointer (u16 LE)
- **Bytes 5–6:** Upper pointer (u16 LE)
- **Bytes 7–10:** Right sibling pointer / next leaf (u32 LE, leaf only)
- **Bytes 11+:** Slot directory (4 bytes per entry: offset + length)

---

## pg_type — Data Type Metadata

Stores one record per registered data type.

| Column Name | Data Type | Constraints | Description |
|-------------|-----------|-------------|-------------|
| `type_oid` | UINT32 | PRIMARY KEY | Unique type identifier |
| `type_name` | VARCHAR(32) | UNIQUE, NOT NULL | Type name (e.g., INT, VARCHAR) |
| `type_category` | UINT8 | NOT NULL | Category: 1=numeric, 2=string, 3=datetime, 4=boolean, 5=binary |
| `type_length` | INT16 | | Fixed length (-1 for variable) |
| `type_align` | UINT8 | | Alignment requirement (bytes) |
| `is_builtin` | BOOL | NOT NULL | Built-in type flag |

**Binary layout:**
```
type_oid(4) | type_name(var) | type_category(1)
  | type_length(2) | type_align(1) | is_builtin(1)
```

### Built-in Types

The following types are registered during bootstrap:

| OID | Name | Category | Length | Alignment |
|-----|------|----------|--------|-----------|
| 1 | INT | Numeric | 4 | 4 |
| 2 | BIGINT | Numeric | 8 | 8 |
| 3 | FLOAT | Numeric | 4 | 4 |
| 4 | DOUBLE | Numeric | 8 | 8 |
| 5 | BOOL | Boolean | 1 | 1 |
| 6 | TEXT | String | -1 (variable) | 1 |
| 7 | VARCHAR(255) | String | -1 (variable) | 1 |
| 8 | DATE | DateTime | 4 | 4 |
| 9 | TIMESTAMP | DateTime | 8 | 8 |
| 10 | BYTES | Binary | -1 (variable) | 1 |

### Type Name Aliases

The type resolver accepts the following aliases (case-insensitive):

| Canonical | Aliases |
|-----------|---------|
| INT | INTEGER, INT32 |
| BIGINT | INT64 |
| FLOAT | REAL, FLOAT32 |
| DOUBLE | FLOAT64 |
| BOOL | BOOLEAN |
| TEXT | STRING |
| BYTES | BYTEA, BLOB |

---

## Relationships Between System Catalogs

```
pg_database
    │
    └──(db_oid)──→ pg_table
                       │
                       ├──(table_oid)──→ pg_column ──→ pg_type (via type_oid)
                       │
                       ├──(table_oid)──→ pg_constraint
                       │
                       └──(table_oid)──→ pg_index
```

All cross-references use OID-based foreign keys, enabling consistent lookups across the catalog hierarchy.

---

## See Also

- [Physical Storage Format](./physical-storage.md) — Detailed byte-level breakdown of `.dat` files and serialisation protocols.
- [Data Structures](./data-structures.md) — Rust types corresponding to these catalog entries.
