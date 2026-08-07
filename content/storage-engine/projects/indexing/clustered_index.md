---
title: Clustered Indexing
sidebar_position: 14
---

### **1. Supported Algorithms**
The system implements an `AnyIndex` enum dispatcher that encapsulates two primary families of indexing:
* **Hash-Based:** `StaticHash`, `ChainedHash`, `ExtendibleHash`, `LinearHash`.
* **Tree-Based:** `BTree`, `BPlusTree`, `RadixTree`, `SkipList`, `LsmTree`.

### **2. Design Rationale**
The architecture uses an **Enum Dispatcher** pattern. Since Rust traits cannot easily support static factory methods (like `load`) via trait objects, `AnyIndex` acts as a concrete wrapper. It forwards all `IndexTrait` calls (insert, search, delete) to the underlying specialized implementations.

---

### **3. Complexity Analysis**
*Based on the implementation logic in `manager.rs` and `executor.rs`:*

| Operation | Complexity (General) | Notes |
| :--- | :--- | :--- |
| **Index Creation** | $O(N \cdot M)$ | $N$ is the number of table pages, $M$ is the number of tuples per page. |
| **Index Update** | $O(\log N)$ or $O(1)$ | Depends on whether the variant is Tree-based (Log) or Hash-based (Amortized constant). |
| **Space Complexity** | $O(K \cdot R)$ | $K$ is key size, $R$ is the number of records. Stored in specialized `.idx` files. |

---

### **4. Storage and Persistence**
#### **Metadata Storage**
* **Format:** JSON.
* **Location:** `CATALOG_FILE` (typically `catalog.json`).
* **Structure:** A nested hierarchy: `Catalog` $\rightarrow$ `Database` $\rightarrow$ `Table` $\rightarrow$ `IndexEntry`.
* **Fields:** Stores `index_name`, `column_names` (supports composite keys), `algorithm` type, and `is_clustered` flags.

#### **Data Storage**
* **Path:** `database/base/{db}/{table}_{index}.idx`.
* **Clustered vs Secondary:** * **Clustered:** The physical table data is reordered on disk to match the index key order.
    * **Secondary:** Stores mappings of `IndexKey` to `RecordId` (Page Number + Item ID).
* **Serialization:** Uses a `paged_store` or algorithm-specific `save/load` methods to write to disk.

---

### **5. Hashing and Collision Handling**
* **Hashing Function:** The code supports multiple strategies via `HashIndexType` (Static, Extendible, Linear). 
* **Composite Keys:** For multi-column indices, components are encoded into bytes, with `INT` values transformed using XOR ($raw \oplus 0x8000\_0000$) to maintain bitwise sortability, then hex-encoded into a `TEXT` key.
* **Collision Handling:** * **ChainedHash:** Uses bucket chaining.
    * **Extendible/Linear:** Uses dynamic resizing/splitting based on `LOAD_FACTOR_THRESHOLD`.

---

### **6. Core Operations**

#### **Search**
* **Point Lookup:** Dispatched via `search`. Supports `search_on_disk` for B+ Trees to allow traversal without loading the entire index into memory.
* **Range Scan:** Supported only by Tree-based variants. Hash-based variants return `io::ErrorKind::Unsupported`.

#### **Insert / Update**
* When a tuple is added to a table, `add_tuple_to_all_indexes` triggers. 
* It extracts the `IndexKey` from the raw tuple bytes (handling `INT`, `TEXT`, and `BOOL` types) and updates every registered index file.

#### **Delete**
* `remove_tuple_from_all_indexes` locates the key and the specific `RecordId` to prune the index.

#### **Clustering**
* `cluster_table_by_index` performs an out-of-place sort of the entire table's live tuples based on the index key and overwrites the table file to ensure physical contiguity.



---

### **7. Data Consistency**
The system includes a validation utility (`validate_index_consistency`) that performs a **Full Table Scan** to build an "expected" key-map and compares it against the "actual" entries stored in the index file, reporting missing or stale entries.
