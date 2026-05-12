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

* Details about Catalog Layer, refer [Catalog Layout](./database-docs/Database-Doc.md)

---

## Table Layer

* Details about Table Layer, refer [Table Layout](./database-docs/Table-Layout.md)

---

## Page Layer

* Details about Table Layer, refer [Page Layout](./database-docs/Page-Layout.md)

---

## Buffer Manager Layer

The Buffer Manager Layer maintains an in-memory cache of pages to minimize disk I/O and efficiently support data loading and manipulation. It uses pin/unpin semantics to prevent eviction of actively used pages, and dirty tracking ensures modified pages are persisted to disk.

The Buffer Manager is used by both user-table operations and the Catalog Manager for system catalog page I/O.
