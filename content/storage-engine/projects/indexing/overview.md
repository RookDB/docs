---
title: Indexing Overview
sidebar_position: 2
---

# Indexing Overview

## Purpose
RookDB currently relies on sequential scans for most lookups.
This project introduces an indexing subsystem to support faster access paths for point and range queries.
The design keeps compatibility with the existing storage stack, including page layout, disk I/O, and buffer handling.

## Objectives
1. Reduce lookup latency on large tables.
2. Support exact match queries through hash and tree indexes.
3. Support range queries through tree indexes.
4. Persist index metadata in the catalog for recovery and startup loading.
5. Keep indexes synchronized with table inserts and deletes.
6. Expose index lifecycle operations through the CLI.

## Initial Scope
The first implementation includes:
1. Hash indexes with static, chain, extendible, and linear variants.
2. B, B+ tree, Radix Tree, Skip List and LSM Tree indexes with point lookup and range scan.
3. Primary key and secondary index metadata support.
4. Covering index metadata support with included columns.
 reordering for clustered storage.

## Storage Model

### Index File Naming
Each index is stored as a separate file.

```text
database/base/{database_name}/{table_name}_{index_name}.idx
```

This separation isolates index lifecycle operations from table data files.

### Page Size and Common Layout
Index files use the same 8 KiB page size as table files.
This allows reuse of existing page read and write paths.

