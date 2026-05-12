---
id: database-doc
title: "Database Doc"
---

### Database Directory Layout
```bash
database/
  ├── global/
  │   └── catalog.json
  └── base/
      ├── db1/
      │   ├── {table}.dat
      │   ├── {table}.dat.fsm
      ├── db2/
      │   ├── {table}.dat
      │   ├── {table}.dat.fsm
```

## Catalog JSON layout Storage

The format is a single JSON file at `database/global/catalog.json`:

```json
{
  "databases": {
    "users": {
      "tables": {
        "students": {
          "columns": [
            {
              "name": "id",
              "data_type": "INT",
              "nullable": true,
              "constraints": {
                "not_null": false,
                "unique": false,
                "default": null,
                "check": null
              }
            },
            {
              "name": "name",
              "data_type": "VARCHAR(10)",
              "nullable": true,
              "constraints": {
                "not_null": false,
                "unique": false,
                "default": null,
                "check": null
              }
            }
          ]
        }
      }
    }
  }
}
```


## Overall Layout of the data
All persistent data used and created by the system is stored inside the `database/` directory. This directory serves as the root location for both metadata and table data. The folder structure and path constants defined in `src/backend/layout.rs` specify how databases and tables are organized as directories and files within this location.


### Directory Descriptions

- **database/**  
  Root directory for all persistent data used and created by the system.

- **global/**  
  Contains system-wide metadata required to interpret database structure.

- **catalog.json**  
  Legacy catalog format.

- **base/**  
  Contains one subdirectory per database.

- **`{database}/`**  
  Represents a single database and holds all table files and index files belonging to it.

- **`{table}.dat`**  
  Physical file corresponding to a table, containing both table metadata and tuple data.

- **`{table}.dat.fsm`**  
  Free Space Map (FSM) fork file.
  Stores free-space metadata used during tuple insertion to quickly locate pages with available space.
  This avoids scanning every heap page during inserts.


## Table File Structure

* Each `{table}.dat` file stores table data as a contiguous sequence of bytes and is divided into fixed-size pages. Each page is 8 KB in size.

* For a detailed explanation of the table file structure and internal storage layout, refer to the [Table Layout](./Table-Layout) documentation.


### Page Structure

The page structure is based on the PostgreSQL slotted-page layout, with only the minimum required metadata implemented.

* For a detailed explanation of the page structure and internal storage layout, refer to the [Page Layout](./Page-Layout) documentation.

### Tuple Structure

* For a detailed explanation of the Tuple structure, refer to the [Tuple Layout](./Tuple-Layout) documentation.