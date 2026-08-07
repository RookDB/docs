---
title: B+ Tree 
sidebar_position: 8
---

### Algorithm

* B+ Tree with minimum degree `t`
* Internal nodes store only routing keys and child pointers
* Leaf nodes store `(key, Vec<RecordId>)`
* Leaves are linked using `next_leaf` pointer (singly linked forward)
* Nodes stored in an arena (`Vec<BPlusNode>`) with stable indices
* All leaves are at the same depth
* Node capacity:

  * Max keys: `2t - 1`
  * Min keys (non-root): `t - 1`

---

### Basic Idea

* Search descends from root to leaf using binary partition (`partition_point`)
* Insert happens at leaf; overflow triggers split and upward propagation
* Delete removes `(key, rid)` and handles underflow via borrow/merge
* Range scan uses linked leaves after initial descent

---

### Time Complexity

* Search: `O(t · log_t n)`
* Insert: `O(t · log_t n)`
* Delete: `O(t · log_t n)`
* Range scan: `O(log n + k)`
* Index creation (bulk via inserts): same as repeated insert

---

### Space Complexity

* In-memory:

  * `O(n)` nodes stored in `Vec<BPlusNode>`
* On-disk:

  * One page per node (`PAGE_SIZE`)
  * Total pages = number of nodes + 1 header page

---

### Metadata File Storage Format

* First page (header page):

  * Bytes 0–8: magic `"RDBIDXV1"`
  * Bytes 8–10: version
  * Bytes 10–12: header size
  * Bytes 12–16: page size
  * Bytes 16–20: root page
  * Bytes 20–24: node page count
  * Bytes 24–32: entry count
  * Bytes 32–36: minimum degree `t`

---

### Data Storage Format (Per Node Page)

* Fixed-size page (`PAGE_SIZE`)
* Header (16 bytes):

  * Byte 0: `is_leaf`
  * Byte 1: `dead`
  * Bytes 2–4: key count
  * Bytes 4–6: child count
  * Bytes 8–12: `next_leaf_page`
  * Bytes 12–16: payload size
* Payload:

  * Keys (encoded sequentially)
  * If leaf:

    * For each key:

      * `rid_count`
      * List of `(page_no, item_id)`
  * If internal:

    * Child page numbers

---

### Hashing / Modulo Function

* Not used

---

### Collision Handling

* Multiple records per key handled via:

  * `values: Vec<Vec<RecordId>>`
  * Same key maps to a vector of record IDs

---

### Operations

#### Search

* Traverse from root using `partition_point`
* At leaf:

  * Binary position lookup
  * Return `Vec<RecordId>` or empty

#### Insert

* Insert into leaf at sorted position
* If key exists:

  * Append `RecordId` if not duplicate
* If overflow (`>= 2t` keys):

  * Split leaf
  * Push first key of right node upward
  * Recursively split internal nodes if needed
* Root split creates new root

#### Delete

* Locate leaf and key
* Remove specific `RecordId`
* If key has no more records:

  * Remove key
* If underflow (`< t-1` keys):

  * Borrow from sibling OR merge
* Propagate fixes upward
* If root becomes empty:

  * Replace with single child

#### Update

* Not explicitly implemented
* Equivalent to:

  * `delete(key, old_rid)` + `insert(key, new_rid)`

---

### Disk Operations

* Save:

  * Header page + serialized node pages
* Load:

  * Parse header
  * Load all node pages into memory
* Direct search:

  * `search_on_disk()` performs traversal without full load

---

### Additional Notes

* Node splitting:

  * Leaf: split at index `t`
  * Internal: median key moves up
* Leaf linking maintained during split/merge
* Dead nodes marked but not reused
* Validation ensures:

  * Sorted keys
  * Proper child counts
  * No cycles in tree or leaf chain

---