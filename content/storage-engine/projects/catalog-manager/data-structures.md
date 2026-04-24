---
title: Data Structures
sidebar_position: 4
---

# Catalog Manager — Data Structures

All core data structures are defined in `src/backend/catalog/types.rs`. This page documents each struct and enum, grouped by subsystem.

---

## 1. Type System

### `DataType`

Metadata about a single data type, mirroring PostgreSQL's `pg_type`.

```rust
pub struct DataType {
    pub type_oid: u32,          // Unique type OID
    pub type_name: String,      // Canonical name (e.g., "INT", "VARCHAR(255)")
    pub type_category: TypeCategory,
    pub type_length: i16,       // Fixed byte length, or -1 for variable
    pub type_align: u8,         // Alignment requirement (1, 2, 4, or 8)
    pub is_builtin: bool,
}
```

`DataType` provides convenience constructors for all built-in types (`DataType::int()`, `DataType::varchar(max_len)`, etc.) and a `from_name()` method that resolves type name strings (case-insensitive, including aliases) to `DataType` instances.

### `TypeCategory`

```rust
pub enum TypeCategory {
    Numeric,    // INT, BIGINT, FLOAT, DOUBLE
    String,     // TEXT, VARCHAR
    DateTime,   // DATE, TIMESTAMP
    Boolean,    // BOOL
    Binary,     // BYTES
}
```

### `TypeModifier`

Optional qualifier for a data type (e.g., `VARCHAR(50)`).

```rust
pub enum TypeModifier {
    VarcharLen(u16),                           // Maximum character length
    Precision { precision: u8, scale: u8 },    // Numeric precision (future)
}
```

### `DefaultValue`

Possible default expressions for a column.

```rust
pub enum DefaultValue {
    Integer(i32),
    BigInt(i64),
    Float(f32),
    Double(f64),
    Str(String),
    Boolean(bool),
    Null,
    CurrentTimestamp,
}
```

---

## Built-In Types Table

RookDB provides 10 built-in types aligned with PostgreSQL conventions. Each type has a unique OID and metadata:

| OID | Name | Category | Length | Align | Aliases |
|-----|------|----------|--------|-------|---------|
| 1 | INT | Numeric | 4 | 4 | INTEGER, INT32 |
| 2 | BIGINT | Numeric | 8 | 8 | INT64 |
| 3 | FLOAT | Numeric | 4 | 4 | REAL, FLOAT32 |
| 4 | DOUBLE | Numeric | 8 | 8 | FLOAT64 |
| 5 | BOOL | Boolean | 1 | 1 | BOOLEAN |
| 6 | TEXT | String | -1 | 1 | STRING |
| 7 | VARCHAR | String | -1 | 1 | VARCHAR(n) |
| 8 | DATE | DateTime | 4 | 4 | — |
| 9 | TIMESTAMP | DateTime | 8 | 8 | — |
| 10 | BYTES | Binary | -1 | 1 | BYTEA, BLOB |

**Note:** `Length = -1` indicates variable-length types stored with a 2-byte length prefix on disk.

The type system is case-insensitive and supports aliases via `DataType::from_name()`.

---

### `Column`

A column within a table, mirroring `pg_column`.

```rust
pub struct Column {
    pub column_oid: u32,                        // Unique column OID
    pub name: String,
    pub column_position: u16,                   // 1-based position within the table
    pub data_type: DataType,
    pub type_modifier: Option<TypeModifier>,
    pub is_nullable: bool,
    pub default_value: Option<DefaultValue>,
    pub constraints: Vec<u32>,                  // OIDs of associated constraints
}
```

### `ColumnDefinition`

Declarative column specification used in DDL statements (CREATE TABLE, ALTER TABLE).

```rust
pub struct ColumnDefinition {
    pub name: String,
    pub type_name: String,          // Type as written in SQL (e.g., "VARCHAR(64)")
    pub type_modifier: Option<u16>,
    pub is_nullable: bool,
    pub default_value: Option<DefaultValue>,
}
```

---

## 3. Constraint System

### `Constraint`

A constraint entry, mirroring `pg_constraint`.

```rust
pub struct Constraint {
    pub constraint_oid: u32,
    pub constraint_name: String,
    pub constraint_type: ConstraintType,
    pub table_oid: u32,
    pub column_oids: Vec<u32>,
    pub metadata: ConstraintMetadata,
    pub is_deferrable: bool,
}
```

### `ConstraintType`

```rust
pub enum ConstraintType {
    PrimaryKey,     // 1
    ForeignKey,     // 2
    Unique,         // 3
    NotNull,        // 4
    Check,          // 5
}
```

### `ConstraintMetadata`

Type-specific metadata attached to each constraint.

```rust
pub enum ConstraintMetadata {
    PrimaryKey { index_oid: u32 },
    ForeignKey {
        referenced_table_oid: u32,
        referenced_column_oids: Vec<u32>,
        on_delete: ReferentialAction,
        on_update: ReferentialAction,
    },
    Unique { index_oid: u32 },
    NotNull,
    Check { check_expression: String },
}
```

### `ReferentialAction`

Referential action for FK `ON DELETE` / `ON UPDATE`.

```rust
pub enum ReferentialAction {
    NoAction,   // 0 — default
    Cascade,    // 1
    SetNull,    // 2
    Restrict,   // 3
}
```

### `ConstraintDefinition`

Declarative constraint specification used in DDL.

```rust
pub enum ConstraintDefinition {
    PrimaryKey { columns: Vec<String>, name: Option<String> },
    ForeignKey {
        columns: Vec<String>,
        referenced_table: String,
        referenced_columns: Vec<String>,
        on_delete: ReferentialAction,
        on_update: ReferentialAction,
        name: Option<String>,
    },
    Unique { columns: Vec<String>, name: Option<String> },
    NotNull { column: String },
    Check { expression: String, name: Option<String> },
}
```

### `ConstraintViolation`

Error produced when a constraint is broken during INSERT/UPDATE.

```rust
pub enum ConstraintViolation {
    NotNullViolation { column: String },
    UniqueViolation { constraint: String },
    ForeignKeyViolation { constraint: String },
    CheckViolation { constraint: String },
}
```

---

## 4. Index Metadata

### `Index`

An index entry, mirroring `pg_index`.

```rust
pub struct Index {
    pub index_oid: u32,
    pub index_name: String,
    pub table_oid: u32,
    pub index_type: IndexType,
    pub column_oids: Vec<u32>,
    pub is_unique: bool,
    pub is_primary: bool,
    pub index_pages: u32,
}
```

### `IndexType`

```rust
pub enum IndexType {
    BTree,  // 1
    Hash,   // 2 (future)
}
```

---

## 5. Table

### `Table`

A table entry, mirroring `pg_table`.

```rust
pub struct Table {
    pub table_oid: u32,
    pub table_name: String,
    pub db_oid: u32,
    pub table_type: TableType,
    pub statistics: TableStatistics,
}
```

### `TableType`

```rust
pub enum TableType {
    UserTable,      // Regular user-created tables
    SystemCatalog,  // System catalog tables (pg_database, pg_table, etc.)
}
```

### `TableStatistics`

Runtime statistics about a table.

```rust
pub struct TableStatistics {
    pub row_count: u64,
    pub page_count: u32,
    pub created_at: u64,        // Unix epoch timestamp
    pub last_modified: u64,     // Unix epoch timestamp
}
```

### `TableMetadata`

Flattened view returned by catalog queries, resolving all OID references.

```rust
pub struct TableMetadata {
    pub table_oid: u32,
    pub table_name: String,
    pub db_oid: u32,
    pub columns: Vec<Column>,
    pub constraints: Vec<Constraint>,
    pub indexes: Vec<Index>,            // Full Index structs, not just OIDs
    pub statistics: TableStatistics,
}
```

---

## 6. Database

### `Database`

A database entry, mirroring `pg_database`.

```rust
pub struct Database {
    pub db_oid: u32,
    pub db_name: String,
    pub owner: String,
    pub encoding: Encoding,
    pub created_at: u64,
}
```

---

## 7. Catalog

### `Catalog`

Top-level catalog: databases in memory plus infrastructure fields.

```rust
pub struct Catalog {
    pub oid_counter: u32,
    pub bootstrap_mode: bool,
    pub page_backend_active: bool,
    pub cache: CatalogCache,
}
```

Infrastructure fields (`oid_counter`, `bootstrap_mode`, `page_backend_active`, `cache`) are **not serialised** to the legacy `catalog.json` — they are re-initialised at load time.

---

## 8. Error Types

### `CatalogError`

```rust
pub enum CatalogError {
    DatabaseNotFound(String),
    DatabaseAlreadyExists(String),
    TableNotFound(String),
    TableAlreadyExists(String),
    ColumnNotFound(String),
    TypeNotFound(String),
    IndexNotFound(String),
    ConstraintNotFound(String),
    AlreadyHasPrimaryKey,
    ReferencedKeyMissing,
    ColumnCountMismatch,
    TypeMismatch { column: String },
    ForeignKeyDependency(String),
    InvalidOperation(String),
    IoError(std::io::Error),
}
```

---

## Module Structure

The catalog data structures are defined across the following files:

| File | Contents |
|------|----------|
| `types.rs` | All struct/enum definitions and `Catalog::new()`, `Catalog::alloc_oid()` |
| `cache.rs` | `CatalogCache` struct with LRU eviction |
| `oid.rs` | `OidCounter` for persistent OID management |
| `serialize.rs` | Binary serialisation/deserialisation for all catalog tuples |
| `page_manager.rs` | `CatalogPageManager` for CRUD on system catalog pages |
| `constraints.rs` | Constraint creation and validation functions |
| `indexes.rs` | Index creation, deletion, and B-Tree operations |
| `catalog.rs` | High-level catalog operations (init, load, create/drop DB/table) |
| `mod.rs` | Module declarations and re-exports |


