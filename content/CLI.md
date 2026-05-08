---
title: User Guide/Interface
sidebar_position: 1
---

# User Guide/Interface
Follow the instructions in the README of the [CLI repository](https://github.com/RookDB/rookdb-cli) to run the `RookDB Interface`. Once it is running, the interface will start accepting SQL queries.

- Once the interface is running, you can enter standard SQL queries.


## Supported Statements

| Statement | Function | Example |
|---|---|---|
| `SHOW DATABASES;` | Lists all available databases. | `SHOW DATABASES;` |
| `CREATE DATABASE database_name;` | Creates a new database. | `CREATE DATABASE company;` |
| `USE database_name;` | Selects a database for subsequent operations. | `USE company;` |
| `SHOW TABLES;` | Lists all tables in the selected database. | `SHOW TABLES;` |
| `CREATE TABLE table_name (...);` | Creates a new table with column definitions. | `CREATE TABLE users (id INT, name VARCHAR(100));` |