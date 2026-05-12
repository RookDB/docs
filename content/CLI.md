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
| `INSERT INTO table_name VALUES (...);` | Inserts a new row into a table. | `INSERT INTO users VALUES (1, 'Hemanth');` |
| `SELECT * FROM table_name;` | Retrieves rows from a table. | `SELECT * FROM users;` |
| `UPDATE table_name SET ... WHERE ...;` | Updates existing rows in a table. | `UPDATE users SET name = 'Kumar' WHERE id = 1;` |
| `DELETE FROM table_name WHERE ...;` | Deletes rows from a table. | `DELETE FROM users WHERE id = 1;` |