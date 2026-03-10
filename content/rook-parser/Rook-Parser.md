# Rook Parser

Rook Parser uses [Apache DataFusion SQL Parser](https://github.com/apache/datafusion-sqlparser-rs) to parse SQL statements into an **AST (Abstract Syntax Tree)**.

The generated AST is then converted into JSON using the [Serde JSON](https://crates.io/crates/serde_json) crate.

Based on this parsed JSON representation, Rook Parser constructs a minimal endpoint output JSON tailored to the specific requirements of RookDB.

Rook Parser is published as a Rust crate and is available at: [Rook Parser Crate](https://crates.io/crates/rook-parser)

The crate exposes APIs that take a **SQL statement as input** and return a **custom JSON output** tailored to the requirements of **RookDB**.

### API output Response
```json
{
    category: CategoryEnum,
    stmt_type: StatementTypeEnum,
    params: ParamsEnum
}
```

```json
enum CategoryEnum {
    DDL,
    DML,
    DQL,
    SPECIAL
}
```

```json
enum StatementTypeEnum {
    ShowDatabases,
    CreateDatabase,
    SelectDatabase,
    ShowTables,
    CreateTable,
    Select,
    Insert
}
```

```json
enum ParamsEnum {
    ShowDatabases,
    CreateDatabase {
        database: String,
        if_not_exists: bool
    },
    SelectDatabase {
        database: String
    },
    ShowTables,
    CreateTable {
        table: String,
        columns: Vec<Column>
    },
    Select {
        tables: Vec<String>,
        projection: Vec<String>,
        filter: Option<String>
    },
    Insert {
        table: String,
        columns: Vec<String>,
        values: Vec<Vec<String>>
    }
}
```

### Example Output
```json
{
  "category": "DQL",
  "type": "ShowDatabases",
  "params": {}
}
```

---

## Few Starting API's
* `SHOW DATABASES`;
* `CREATE DATABASE db_name`;
* `SELECT DATABASE db_name`;
* `SHOW TABLES`;
* `CREATE TABLE table_name ...`;
* `SELECT * FROM table_name`;
* `INSERT INTO table_name`;