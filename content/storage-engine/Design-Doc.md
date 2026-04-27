---
id: design-doc
title: "Design Doc"
---

## Introduction to RookDB

RookDB is a disk-oriented database management system (DBMS) aimed at exploring the internal architecture of modern database engines, with a particular focus on the design and implementation of the **Storage Manager** of DBMS. The system follows a **Relational Database model**, similar to widely used relational DBMS such as PostgreSQL and MySQL.

![Relation Model DBMS Architecture](/assets/DBMS-Arch.png)

Based on the relational database architecture shown in the above figure, the primary objective of RookDB is to implement the key components of the storage manager that operate between the query processor and the underlying disk storage.

---

## RookDB Architecture

The architecture of RookDB follows a layered design that separates logical metadata management from the physical representation of tables and the low-level organization of records within pages.

The storage manager in RookDB is broadly divided into the following layers:

- Catalog Layer  
- Table Layer  
- Page Layer  
- Buffer Manager Layer  

---

## Catalog Layer

The Catalog Layer is responsible for managing all logical metadata required by the database system — databases, tables, columns, constraints, indexes, and data types.

RookDB implements a **self-hosting, page-based catalog system** modelled after PostgreSQL's system catalogs. Metadata is stored in six dedicated system catalog files (`pg_database`, `pg_table`, `pg_column`, `pg_constraint`, `pg_index`, `pg_type`) using the same 8 KB slotted-page format as user tables.

Key capabilities of the Catalog Layer include:

- **OID (Object Identifier) system** — every database object receives a globally unique 32-bit identifier, enabling robust cross-references between catalog entries.
- **Constraint management** — supports Primary Key, Foreign Key (with cascading actions), Unique, NOT NULL, and Check constraints.
- **Extended type system** — ten built-in types (INT, BIGINT, FLOAT, DOUBLE, BOOL, TEXT, VARCHAR, DATE, TIMESTAMP, BYTES) with alignment and length metadata.
- **In-memory LRU cache** — reduces disk I/O for frequently accessed metadata with automatic invalidation on DDL operations.
- **Buffer Manager integration** — all catalog I/O is routed through the Buffer Manager for efficient page caching.

A legacy JSON-based catalog (`catalog.json`) is retained for backward compatibility. On a fresh install, the system bootstraps directly into page-based mode.

For a detailed description of the catalog architecture, see the [Catalog Manager](./projects/catalog-manager/catalog-manager.md) documentation.

---

## Table Layer

In RookDB, each table is stored as a dedicated file within the directory corresponding to its parent database. This hierarchical organization mirrors the structure of the catalog and provides a deterministic mapping from logical table identifiers to their physical storage locations on disk.

Each table file is logically divided into two distinct regions. The first region is a fixed-size table header occupying the initial 8 KB of the file. This header stores metadata required for table management, currently stores only the total number of allocated pages. The second region consists of a sequence of fixed-size data pages, each 8 KB in size, which store tuple data along with associated slot metadata.

![Logical Layout of a Table File](/assets/Table-Architecture.png)

---

## Page Layer

The Page Layer defines the internal layout and organization of records within a fixed-size page.  
RookDB adopts a slotted-page structure inspired by PostgreSQL, consisting of a page header, an item identifier array, and tuple data.

![Logical Layout of a Page](/assets/Page-Architecture.png)

---

## Buffer Manager Layer

The Buffer Manager Layer maintains an in-memory cache of pages to minimize disk I/O and efficiently support data loading and manipulation. It uses pin/unpin semantics to prevent eviction of actively used pages, and dirty tracking ensures modified pages are persisted to disk.

The Buffer Manager is used by both user-table operations and the Catalog Manager for system catalog page I/O.
