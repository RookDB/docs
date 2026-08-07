---
title: BTree 
sidebar_position: 7
---


### Algorithm

* Classic B-Tree (Knuth / CLRS definition).
* Minimum degree `t`.
* Each node:

  * Stores `keys: Vec<IndexKey>`
  * Stores `values: Vec<Vec<RecordId>>` (multiple RIDs per key)
  * Stores `children: Vec<usize>` (indices into arena)
  * `is_leaf`, `dead` flags
* Nodes stored in a flat arena: `Vec<BTreeNode>`
* Root tracked by index.
* All leaves at same depth.
* Internal node: `k` keys → `k+1` children.
* Node capacity: `[t−1, 2t−1]` keys (except root).

---

### Basic Idea

* Tree-based index storing keys in sorted order.
* Each key maps to one or more record IDs.
* Uses balanced multi-way tree.
* Insert splits full nodes.
* Delete uses merge/rotation (CLRS algorithm).
* Arena-based storage using indices instead of pointers. 

---

### Time Complexity

(from code comments)

| Operation  | Complexity         |
| ---------- | ------------------ |
| search     | O(t · log_t n)     |
| insert     | O(t · log_t n)     |
| delete     | O(t · log_t n)     |
| range_scan | O(t · log_t n + k) |

---

### Space Complexity

* Nodes stored in `Vec<BTreeNode>` (arena).
* Each node holds up to `2t−1` keys.
* Deleted nodes remain as tombstones (`dead = true`).
* Overall: **O(n)** space.

---

### Metadata Storage Format

* Entire structure serialized using `serde::{Serialize, Deserialize}`.
* Persistence:

  * `save()` → `paged_store::save_entries(...)`
  * `load()` → `paged_store::load_entries_stream(...)`
* No explicit separate metadata file structure defined in code.
* Metadata implicitly:

  * `nodes` vector
  * `root` index
  * `t`
  * `entry_count`

---

### Data Storage Format

* Stored as `(IndexKey, RecordId)` pairs via paged store.
* On load:

  * Entries streamed and inserted one-by-one.
* In-memory:

  * Keys stored in nodes
  * Values stored as `Vec<RecordId>` per key
* Tree reconstructed from entries (no direct node serialization in load).

---

### Hashing / Modulo Function

* Not used.
* Tree-based index (ordered structure).

---

### Collision Handling

* Multiple records for same key stored as:

  * `values[i] = Vec<RecordId>`
* Duplicate keys not duplicated structurally.
* Record IDs appended if key exists.

---

### Operations

#### Search

* Binary search using `partition_point`.
* If key found → return `values[pos]`.
* Else descend to correct child.
* Leaf → return empty.

---

#### Insert

* If root full → split.
* Use `insert_non_full`:

  * If key exists → append RID if not present.
  * Else insert key + new RID.
* Child split done before descending if full.

---

#### Delete

* Two-step:

  1. Remove specific `(key, rid)` from values.
  2. If values empty → remove key structurally.
* Structural deletion:

  * Uses CLRS algorithm:

    * Replace with predecessor/successor
    * Rotate (left/right)
    * Merge children
* Nodes merged → right node marked `dead`.

---

#### Update

* Not explicitly implemented.
* Equivalent to:

  * delete(old key, rid)
  * insert(new key, rid)

---

#### Range Scan

* In-order traversal:

  * Visit children and keys in sorted order.
  * Collect RIDs within `[start, end]`.

---

#### Validation

* Ensures:

  * Keys sorted
  * Values match keys
  * No empty RID lists
  * Correct child count
  * No cycles
  * No reachable dead nodes

---

#### Additional Notes

* Arena-based node storage using indices.
* Tombstoned nodes not reclaimed.
* Supports:

  * `min_key()`
  * `max_key()`
  * full traversal (`all_entries`)
