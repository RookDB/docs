---
title: Radix Tree
sidebar_position: 9
---


### Algorithm

A radix tree (compressed trie) stores keys as byte sequences. Consecutive single-child nodes are merged into a single node with a multi-byte prefix. Each node represents a prefix of keys and branches based on the next byte.

Insertion uses longest common prefix (LCP) comparison:

* If partial match → node split.
* If full match → descend or mark terminal.

Search and delete traverse using prefix matching.

---

### Basic Idea

* Keys are converted to byte arrays using `IndexKey::as_bytes()` 
* Tree stores compressed prefixes instead of single characters
* Each node:

  * `prefix`: compressed edge label
  * `children`: sorted map (byte → node)
  * `terminal`: optional `(key, [record_ids])`

---

### Time Complexity

Let `k = key length in bytes`

| Operation      | Complexity        |
| -------------- | ----------------- |
| Index Creation | O(n · k)          |
| Insert         | O(k)              |
| Search         | O(k)              |
| Delete         | O(k)              |
| Range Scan     | O(k + k · output) |

---

### Space Complexity

* O(total bytes of all keys)
* Prefix compression reduces redundancy
* Additional overhead:

  * `BTreeMap` per node
  * RecordId vectors at terminals

---

### Metadata Storage Format

* No explicit metadata file structure defined
* Tree is reconstructed using:

  * `paged_store::load_entries_stream(path, ...)` 
* Entries are streamed and inserted into the tree

---

### Data Storage Format

* Stored via:

  * `paged_store::save_entries(path, iterator)` 
* Format:

  * Sequence of `(IndexKey, RecordId)` pairs
* Tree structure itself is **not serialized directly**
* Rebuilt by replaying inserts

---

### Hashing / Modulo Function

* Not used
* Structure is tree-based, not hash-based

---

### Collision Handling

* Not applicable (no hashing)
* Multiple records per key handled via:

  * `terminal: Option<(IndexKey, Vec<RecordId>)>`

---

### Operations

#### Search

* Traverse using prefix matching
* If full match and terminal exists → return record IDs
* Else → return empty

#### Insert

* Compute LCP with node prefix
* Cases:

  * Partial match → split node
  * Full match → descend or create child
  * Exact match → append RecordId (no duplicates)

#### Delete

* Traverse to terminal node
* Remove specific RecordId
* If empty:

  * Remove terminal
  * If node becomes empty → prune
  * If single child → compress (merge)

#### Update

* Not explicitly implemented
* Equivalent to:

  * Delete(old_key, rid)
  * Insert(new_key, rid)

---

### Additional Behavior

* Children stored in `BTreeMap` → maintains sorted order
* Enables correct lexicographic range scans
* Range scan:

  * Recursively collects keys within `[start, end]`
* Supports:

  * `min_key()`
  * `max_key()`
  * `entry_count()`
  * structural validation

---
