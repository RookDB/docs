---
title: Overview
sidebar_position: 1
---

# Catalog Manager — Overview

## Motivation

Prior to the Catalog Manager project, RookDB stored all metadata in a single JSON file (`database/global/catalog.json`). While simple, this approach had several limitations:

- **No scalability** — the entire catalog was serialised and deserialized on every operation, making it impractical for large numbers of tables.
- **No constraint support** — there was no mechanism to define or enforce primary keys, foreign keys, unique constraints, or NOT NULL.
- **No type metadata** — only `INT` and `TEXT` were supported, with no extensible type system.
- **No buffer integration** — catalog I/O bypassed the buffer manager entirely.
- **No object identity** — tables and columns had no unique identifiers, making references fragile.

## Goals

The Catalog Manager project addresses these limitations by introducing:

1. **Page-based catalog storage** — system catalogs are stored as slotted pages (identical format to user tables), enabling integration with the buffer manager and supporting large-scale metadata.
2. **Self-hosting architecture** — system catalog tables describe themselves, following PostgreSQL's proven design.
3. **Normalized metadata** — database objects (databases, tables, columns, etc.) are decoupled in memory and storage, linked via OIDs for improved scalability.
4. **Lazy-loading backend** — metadata is loaded on-demand from disk and cached, rather than eager-loading the entire catalog into memory at startup.
5. **OID system** — every database object receives a persistent, unique 32-bit Object Identifier.
6. **Constraint system** — full support for PRIMARY KEY, FOREIGN KEY (with cascading actions), UNIQUE, NOT NULL, and CHECK constraints.
7. **Extended type system** — ten built-in types (INT, BIGINT, FLOAT, DOUBLE, BOOL, TEXT, VARCHAR, DATE, TIMESTAMP, BYTES) with alignment and length metadata.
8. **In-memory LRU cache** — reduces redundant page reads with automatic invalidation on every DDL operation.

## Design Principles

The design is guided by the following principles:

- **Consistency with RookDB internals** — catalog pages use the same 8 KB slotted-page layout as user tables, reusing existing page and disk infrastructure.
- **PostgreSQL conventions** — system catalog naming (`pg_database`, `pg_table`, etc.), OID-based references, and constraint semantics follow PostgreSQL precedents.
- **Decoupled Entities** — metadata is stored in a normalized form. In-memory structs (`Table`, `Database`) do not hold nested collections; instead, relationships are resolved at runtime via the `Catalog` orchestration layer.
- **Lazy Load, Eager Invalidate** — data is loaded lazily into the cache to minimize startup time and memory footprint, but invalidated eagerly on DDL changes to ensure consistency.
- **Write-through durability** — DDL changes are persisted immediately to the page backend; the OID counter is written to disk on every allocation to prevent reuse after a restart.

## Scope

The Catalog Manager project modifies or creates files across the following areas:

| Area | Files |
|------|-------|
| Catalog module (`src/backend/catalog/`) | `types.rs`, `catalog.rs`, `mod.rs`, `constraints.rs`, `indexes.rs`, `cache.rs`, `oid.rs`, `page_manager.rs`, `serialize.rs` |
| Buffer Manager (`src/backend/buffer_manager/`) | `buffer_manager.rs`, `mod.rs` |
| Executor (`src/backend/executor/`) | `load_csv.rs`, `seq_scan.rs` |
| Frontend (`src/frontend/`) | `menu.rs`, `database_cmd.rs`, `table_cmd.rs`, `data_cmd.rs` |
| Layout (`src/backend/`) | `layout.rs` |
| Tests (`tests/`) | `test_catalog_bootstrap.rs`, `test_catalog_cache.rs`, `test_catalog_operations.rs`, `test_constraints.rs`, `test_indexes.rs`, `test_serialization.rs`, `test_type_system.rs` |

---

## Implementation

The final implementation comprises **~3,000 lines of Rust** organized into **8 core modules**:

| Module | Lines | Purpose |
|--------|-------|---------|
| `types.rs` | 485 | Data structures: types, columns, constraints, indexes, tables, databases, errors |
| `serialize.rs` | 416 | Binary serialization/deserialization for all catalog tuple types |
| `page_manager.rs` | 289 | Low-level CRUD on system catalog pages via Buffer Manager |
| `oid.rs` | 110 | Persistent OID allocation with crash-safety |
| `cache.rs` | 236 | LRU in-memory cache with DDL-triggered invalidation |
| `constraints.rs` | 411 | Constraint creation, validation, and enforcement |
| `indexes.rs` | 440 | B-Tree index management and lookup |
| `catalog.rs` | 615 | High-level API for catalog initialization and operations |
| **Total** | **~3,000** | — |

### Capabilities

- **6 system catalogs** stored using the same 8KB slotted-page format as user tables
- **10 built-in types** with PostgreSQL-compatible OID allocation (1–10 for built-ins, 10,000+ for user objects)
- **5 constraint types** — PRIMARY KEY, FOREIGN KEY, UNIQUE, NOT NULL, and CHECK — enforced via B-Tree indexes
- **Crash-safe OID allocation** with immediate persistence to `pg_oid_counter.dat` on every allocation
- **256-entry LRU cache** with DDL-triggered invalidation for consistent metadata reads
- **Lazy-loading** — metadata is loaded on-demand, minimising startup time and memory usage
- **Variable-length tuple support** — names, expressions, and type modifiers stored with length-prefixed encoding

---

## Storage

All metadata is stored in `database/global/catalog_pages/` as slotted-page `.dat` files. On first startup, RookDB bootstraps the page backend automatically — no manual setup is required.

---

## Future Work

- **CHECK constraint evaluation** — expression parser for runtime CHECK validation
- **Vacuum** — compact catalog pages by reclaiming logically deleted slots
- **Statistics collection** — table cardinality and column distributions for query planning
- **User-defined types** — extensible type system for composite and domain types
- **Partitioning** — metadata support for table partitions

