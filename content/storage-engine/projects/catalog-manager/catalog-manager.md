---
title: Catalog Manager
sidebar_position: 4
---

# Catalog Manager

The Catalog Manager is a core subsystem of RookDB responsible for managing all **database metadata** — the information that describes databases, tables, columns, constraints, indexes, and data types. It replaces the original JSON-based catalog (`catalog.json`) with a self-hosting, **page-based storage system** modelled after PostgreSQL's system catalogs.

## Key Features

- **Page-based catalog storage** using the same slotted-page format as user tables
- **Self-hosting architecture** — system catalogs describe themselves
- **OID (Object Identifier) system** for uniquely identifying every database object
- **Comprehensive constraint support** — Primary Key, Foreign Key, Unique, NOT NULL, Check
- **B-Tree index management** for efficient constraint enforcement
- **In-memory LRU cache** with DDL-triggered invalidation
- **Dual-mode operation** — legacy JSON and page-based backends
- **Buffer Manager integration** for efficient I/O

## Documentation

- [Overview](./overview.md) — Motivation, goals, and high-level design
- [Architecture](./architecture.md) — Storage architecture, directory layout, and buffer integration
- [System Catalogs](./system-catalogs.md) — Schema definitions for all six system catalog tables
- [Data Structures](./data-structures.md) — Rust data types powering the catalog
- [API Reference](./api-reference.md) — Public API functions and their signatures
- [Implementation Notes](./implementation-notes.md) — Design corrections and deviations from the original proposal
- [Physical Storage](./physical-storage.md) — Byte-level layout of catalog pages and serialization