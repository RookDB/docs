---
id: show_databases
title: "Show Databases"
---
### **Show Databases**

**Description:**  
Displays all databases currently registered in the in-memory catalog. The function reads database metadata from the loaded catalog and prints the database names to the console.

**Function:**  
```rust
pub fn show_databases(catalog: &Catalog)
```

**Input:**
- `catalog` — Read-only reference to the in-memory catalog containing database metadata.

**Output:**
- No return value (`()`).
- Prints the list of database names to the console.
- If no databases exist, prints:
  ```
  No databases found.
  ```

**Implementation:**
1. Log a header indicating that database information is being displayed.
2. Check whether `catalog.databases` is empty.
3. If no databases exist:
   - Log the message.
   - Print `"No databases found."`.
   - Return immediately.
4. Iterate through all keys in:
   ```rust
   catalog.databases
   ```
5. Print each database name to the console.
6. Log the displayed database names.

**Internal API Calls:**
- `catalog.databases.is_empty()`
  - Checks whether any databases are registered in the catalog.

- `catalog.databases.keys()`
  - Retrieves all database names stored in the catalog.

- `log::debug!(...)`
  - Writes debug information to the logging system.

- `log::info!(...)`
  - Writes informational messages to the logging system.

- `println!(...)`
  - Displays database names to the user.

**Files Created/Modified:**
- None.

**Catalog Updates:**
- None.
- The function is read-only and does not modify catalog metadata.