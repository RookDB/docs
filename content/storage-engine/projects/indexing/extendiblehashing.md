---
title: Extendible Hash
sidebar_position: 5
---

### Algorithm

* Extendible hashing with:

  * **Global depth (`global_depth`)**
  * **Directory (`Vec<usize>`)** mapping to buckets
  * **Buckets (`Vec<EHBucket>`)** each with **local depth (`local_depth`)**
* On overflow:

  * If `local_depth < global_depth` → split bucket
  * If `local_depth == global_depth` → double directory, then split
* Directory slots may point to the same bucket (shared buckets)

---

### Basic Idea

* Use lower `global_depth` bits of `hash_code()` to index directory
* Directory points to buckets
* Buckets store `(key → Vec<RecordId>)`
* Growth handled by:

  * Directory doubling
  * Bucket splitting
* Entries redistributed after split using updated hash mapping

---

### Time Complexity

* **Lookup:** `O(1)`
* **Insert:** `O(1)` amortised, `O(n)` during rare directory doubling
* **Delete:** `O(1)`
* **Update (insert existing key):** `O(1)`


---

### Space Complexity

* `O(n)`
* Includes:

  * Directory (`2^global_depth`)
  * Buckets
  * Entries and record lists


---

### Metadata Storage Format

* Entire structure is **serialized/deserialized using `serde`**
* Stored fields:

  * `global_depth: u32`
  * `directory: Vec<usize>`
  * `buckets: Vec<EHBucket>`
* Each `EHBucket`:

  * `local_depth: u32`
  * `entries: Vec<EHEntry>`
* Each `EHEntry`:

  * `key: IndexKey`
  * `records: Vec<RecordId>`

---

### Data Storage (Persistent)

* Uses:

  * `paged_store::save_entries(...)`
  * `paged_store::load_entries_stream(...)`
* Storage format:

  * Flat stream of `(IndexKey, RecordId)`
* On load:

  * Reconstructed via repeated `insert()` calls

---

### Hashing / Modulo Function

* Directory index:

  ```rust
  (key.hash_code() as usize) & ((1 << global_depth) - 1)
  ```
* Uses **bit masking (modulo by power of 2)** on hash

---

### Collision Handling

* Multiple keys in same bucket → stored in `entries: Vec<EHEntry>`
* Same key:

  * Multiple `RecordId`s stored in `records: Vec<RecordId>`
* Overflow handled by:

  * Bucket splitting
  * Directory expansion

---

### Operations

#### Search

* Compute directory index
* Lookup bucket
* Linear scan in bucket (`find`)
* Return matching record list

#### Insert

* Compute directory index
* If key exists → append `record_id` (no duplicates)
* If bucket not full → insert
* If full:

  * Split bucket
  * Retry insert (loop)

#### Delete

* Locate bucket
* Find key
* Remove matching `record_id` using `retain`
* Returns success if deletion happened

#### Update

* Same as insert for existing key:

  * Adds new `record_id` if not present

---

### Additional Structural Rules

* Directory size = `2^global_depth`
* Bucket `local_depth <= global_depth`
* Bucket capacity enforced via `EXTENDIBLE_HASH_BUCKET_CAPACITY`
* Directory may have duplicate bucket references
* Entry must have non-empty `records`

---
