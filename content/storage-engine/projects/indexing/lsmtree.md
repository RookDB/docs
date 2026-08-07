---
title: LSM Tree
sidebar_position: 11
---

**Algorithm:**

* In-memory **memtable**: `BTreeMap<IndexKey, Vec<RecordId>>`
* Immutable **runs**: `Vec<LsmRun>` where each run stores a `BTreeMap<IndexKey, Vec<RecordId>>` 
* Insert into memtable → flush to runs when `memtable_limit` reached → optional full compaction when runs > 8 

---

**Basic Idea:**

* Writes go to memtable (sorted BTreeMap).
* When full, memtable is flushed as a new run (immutable).
* Reads check memtable first, then runs (newest to oldest).
* Compaction merges all runs into one, keeping latest values. 

---

**Time Complexity:**

* Insert:

  * `O(log n)` (BTreeMap insert) + occasional flush `O(n)`
* Search:

  * `O(log n)` (memtable) + `O(R * log n)` worst-case over runs
* Delete:

  * Same as search + `O(k)` for filtering record IDs
* Compaction:

  * `O(total_entries)`

---

**Space Complexity:**

* `O(N)` total across memtable + runs
* Temporary `O(N)` during compaction

---

**Metadata Storage Format:**

* No explicit separate metadata file
* Entire index reconstructed using:

  * `paged_store::load_entries_stream(path, |key, rid| insert(...))` 

---

**Data Storage Format:**

* Stored as flat `(IndexKey, RecordId)` pairs via:

  * `paged_store::save_entries(path, iterator)` 
* Logical structure (memtable + runs) is rebuilt on load

---

**Hashing / Modulo:**

* Not used
* Uses ordered `BTreeMap`

---

**Collision Handling:**

* Multiple `RecordId`s per key stored as `Vec<RecordId>`
* Duplicate prevention via `if !list.contains(&record_id)` 

---

**Operations:**

* **Search:**

  * Check memtable → then runs in order → return first match

* **Insert:**

  * Add to memtable
  * Avoid duplicate record IDs
  * Trigger flush if limit reached

* **Delete:**

  * If in memtable → remove directly
  * Else → fetch current values → rewrite updated version into memtable

* **Update:**

  * Not explicit; achieved via insert/delete combination

---
