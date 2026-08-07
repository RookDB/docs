---
title: Skip List
sidebar_position: 10
---

**Basic Idea**

* Implements an ordered index using an in-memory `BTreeMap<IndexKey, Vec<RecordId>>`.
* Each key maps to a list of record IDs to support duplicate keys.
* Despite the name, it is not an actual probabilistic skip list; ordering and range behavior are provided by `BTreeMap`.

---

**Time Complexity**

* **Insert:** `O(log N + K)`

  * `log N` for map insertion, `K` for checking duplicates in vector.
* **Search:** `O(log N + K)`

  * `log N` for lookup, `K` for returning all record IDs.
* **Delete:** `O(log N + K)`

  * `log N` for lookup, `K` for filtering vector.
* **Range Scan:** `O(log N + M)`

  * `log N` to locate range start, `M` total elements in range.
* **Index Creation (load):** `O(T log N)`

  * Inserts all entries sequentially using `insert`.

---

**Space Complexity**

* `O(N + T)`

  * `N` = number of unique keys
  * `T` = total number of `(key, record_id)` pairs

---

**Metadata Storage Format**

* No explicit metadata structure is defined.
* No separate metadata file is created or managed.

---

**Data Storage Format**

* Stored using `paged_store::save_entries` as a stream of `(IndexKey, RecordId)` pairs.
* Loading is performed via `paged_store::load_entries_stream`, reconstructing the index by reinserting entries.
* Data is not stored as a tree or levels; it is serialized as flat key–record pairs.

---

**Hashing / Modulo Function**

* Not used.
* Index is tree-based (`BTreeMap`), not hash-based.

---

**Collision Handling**

* Multiple records for the same key are stored in a `Vec<RecordId>`.
* Duplicate `(key, record_id)` pairs are prevented by checking `list.contains()` before insertion.

---

**Operations**

* **Insert**

  * Adds `record_id` to the vector for a key.
  * Avoids duplicates.

* **Search**

  * Returns all record IDs for a given key.
  * Returns empty vector if key is absent.

* **Delete**

  * Removes specific `record_id` from the key’s vector.
  * Removes key entirely if no record IDs remain.

* **Update**

  * Not explicitly implemented.
  * Achieved via delete + insert.

* **Range Scan**

  * Uses ordered traversal via `BTreeMap::range`.
  * Returns concatenated record IDs within `[start, end]`.

* **Min / Max Key**

  * Retrieved using ordered key iterators (`next`, `next_back`).

---

**Validation**

* Ensures no key has an empty `Vec<RecordId>`.
* Returns error if such a case is found.
