---
title: Catalog Integration
sidebar_position: 12
---


## 1. Catalog Extension

Each table in the catalog maintains index metadata alongside column definitions.

* Indexes are stored per table and keyed by index name.
* Metadata is persisted and loaded at startup.

### Index Metadata Includes

* Indexed columns (supports multi-column indexes)
* Index algorithm (hash/tree variants)
* Uniqueness flag
* Clustered flag (only one allowed per table)
* Included columns (for covering indexes)
* Index file location (for physical storage)

---

## 2. Lifecycle Integration

### Creation

When an index is created:

1. Validate columns and constraints (existence, duplicates, clustered rules)
2. Add entry to catalog
3. Persist catalog to disk
4. Trigger index build from table data
5. Create and link physical index file

### Deletion

* Remove index metadata from catalog
* Delete or detach corresponding index file

### Startup

* Catalog is loaded from disk
* Index metadata is used to locate and initialize index structures
* Enables immediate query-time usage

---

## 3. Query Integration

* Query planner consults catalog to discover available indexes
* Selects appropriate index based on:

  * Indexed columns
  * Algorithm type
  * Query predicates
* Execution layer uses catalog metadata to route lookups to the correct index structure

---

## 4. Design Principles

* Catalog is the **single source of truth** for index metadata
* Physical index structures are **decoupled but referenced**
* Validation is enforced at catalog level before index creation
* Supports extensibility for new index types and configurations
