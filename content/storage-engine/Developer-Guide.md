---
title: Developer Guide
sidebar_position: 5
---

# Developer Guide

Follow the instructions in the README of the [RookDB/RookDB](https://github.com/RookDB/RookDB) to run the `Storage Engine`. After the system starts, the interface will display a list of available operations to choose from.

**The Storage Engine currently provides the following options:**

#### Show Databases
Displays all databases available in the catalog with metadata (owner, creation timestamp).

---

#### Create Database

Creates a new database with metadata and updates the catalog.

Steps:
1. Enter a database name when prompted
2. Enter the owner name (or use the default)
3. The database is registered in `pg_database` and the data directory is created

Example:
```
Database name: users
Owner: admin
```

---

#### Select Database

Sets the active database for performing operations.

Steps:
1. Enter a database name from the displayed list

---

#### Show Tables

Displays all tables in the selected database with statistics (row count, page count, creation timestamp).

---

#### Create Table

Creates a new table with a schema and optional constraints.

Steps:
1. Enter table name
2. Enter columns using format:

```
column_name:data_type[:constraint]
```

3. Press Enter on an empty line to finish

Supported Types:
- INT (alias: INTEGER, INT32)
- BIGINT (alias: INT64)
- FLOAT (alias: REAL, FLOAT32)
- DOUBLE (alias: FLOAT64)
- BOOL (alias: BOOLEAN)
- TEXT (alias: STRING)
- VARCHAR(n)
- DATE
- TIMESTAMP
- BYTES (alias: BYTEA, BLOB)

Supported Inline Constraints:
- `PRIMARY KEY` — unique, not-null constraint with a backing B-Tree index
- `NOT NULL` — disallows NULL values

Example:
```
id:INT:PRIMARY KEY
name:TEXT:NOT NULL
email:VARCHAR(100)
```

After defining columns, you can also define table-level constraints such as composite primary keys and foreign keys.

---

#### Load CSV

Loads CSV data into an existing table. Constraint validation is performed during loading — rows that violate PRIMARY KEY, UNIQUE, FOREIGN KEY, or NOT NULL constraints are rejected.

Steps:
1. Enter table name
2. Enter CSV file path

Example:
```
examples/example.csv
```

---

#### Show Tuples

Displays tuples stored in table pages along with page metadata such as pointers and tuple count.

---

#### Show Table Statistics

Displays storage statistics like total number of pages.

---

#### Exit

Exit from RookDB.