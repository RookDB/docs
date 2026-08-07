---
title: Chain Hash
sidebar_position: 4
---


### Algorithm

The implementation is a **chained hash index** using:

* Fixed number of buckets (`bucket_count`)
* Each bucket is a `Vec<ChainEntry>`
* Each `ChainEntry` contains:

  * `key: IndexKey`
  * `records: Vec<RecordId>`

---

### Basic Idea

* Keys are hashed using `key.hash_code()`
* Bucket index is computed using modulo operation
* Each bucket stores a list of entries (separate chaining)
* Each key maps to multiple `RecordId`s

---

### Time Complexity

* **Index Creation (load)**
  Uses `paged_store::load_entries_stream` and calls `insert` per entry
  → **O(N × bucket_scan)**

* **Insert**

  * Bucket lookup: O(1)
  * Scan within bucket: O(k)
    → **O(k)**

* **Search**

  * Bucket lookup: O(1)
  * Scan within bucket: O(k)
    → **O(k)**

* **Delete**

  * Bucket lookup: O(1)
  * Scan + retain: O(k + r)
    → **O(k + r)**

Where:

* `k` = number of entries in a bucket
* `r` = number of record IDs in an entry

---

### Space Complexity

* Buckets: `O(bucket_count)`
* Entries: `O(number_of_keys)`
* Record storage: `O(total_record_ids)`
* Total: **O(bucket_count + keys + records)**

---

### Metadata File Storage Format

* Uses `paged_store::save_entries`
* Data is written as a stream of `(IndexKey, RecordId)` pairs
* No explicit metadata structure in this code
* Serialization derives:

  * `Serialize`, `Deserialize` on structs

---

### Data Storage Format

* Internally:

  ```
  buckets: Vec<Vec<ChainEntry>>
  ```
* Flattened during save:

  ```
  Vec<(IndexKey, RecordId)>
  ```
* Each `(key, record_id)` pair stored independently

---

### Hashing / Modulo Function

```
bucket_index = (key.hash_code() as usize) % bucket_count
```

---

### Collision Handling

* **Separate chaining**
* Each bucket is a `Vec<ChainEntry>`
* Multiple keys in same bucket handled via linear scan

---

### Operations

#### Search

* Compute bucket index
* Find entry with matching key
* Return cloned `records`
* If not found → empty vector

---

#### Insert

* Compute bucket index
* If key exists:

  * Add `record_id` if not already present
* Else:

  * Create new `ChainEntry`
  * Append to bucket

---

#### Delete

* Compute bucket index
* Find matching entry
* Remove `record_id` using `retain`
* If no records remain:

  * Remove entire `ChainEntry`
* Returns `true` if deletion occurred

---

#### Update

* Not explicitly implemented
* Can be inferred as:

  * Delete old `(key, record_id)`
  * Insert new `(key, record_id)`

---

### Additional Functions

* **save**
  Writes all `(key, record_id)` pairs using paged store

* **all_entries**
  Flattens buckets into vector of pairs

* **entry_count**
  Total number of record IDs across all entries

* **validate_structure**

  * `bucket_count > 0`
  * `bucket_count == buckets.len()`
  * No entry has empty `records`

* **load_factor**

  ```
  entry_count / bucket_count
  ```

* **index_type_name**

  ```
  "chained_hash"
  ```
