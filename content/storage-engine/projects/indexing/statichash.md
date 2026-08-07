---
title: Static Hash
sidebar_position: 3
---

### 1. Algorithm Overview

The implementation is a **static hash-based index** with:

* Fixed number of buckets (`num_buckets`)
* Each bucket contains:

  * Primary storage (`entries`)
  * Overflow storage (`overflow` → list of segments)

Each **key maps to a bucket** using a hash function, and each bucket stores:

* `BucketEntry { key, records: Vec<RecordId> }`

---

### 2. Basic Idea

* Compute bucket index using hash modulo.
* Store `(key → multiple record_ids)` inside bucket entries.
* If primary bucket is full:

  * Use overflow segments.
  * Each segment has the same capacity as primary.
* Duplicate `(key, record_id)` pairs are avoided.

---

### 3. Time Complexity

Let:

* `B = STATIC_HASH_BUCKET_CAPACITY`
* `O = number of overflow segments in a bucket`

**Index Creation (load):**

* Inserts each entry via streaming
  → **O(N × (B + O·B))**

**Insert:**

* Search existing key: scan primary + overflow
  → **O(B + O·B)**
* Insert is O(1) after location found

**Search:**
→ **O(B + O·B)**

**Delete:**
→ **O(B + O·B)**

**Update (not explicitly implemented):**

* Would be delete + insert
  → **O(B + O·B)**

---

### 4. Space Complexity

* Buckets: `num_buckets`
* Each bucket:

  * Primary capacity: `B`
  * Overflow grows dynamically

Total:
→ **O(N)** (records stored across buckets and overflow)

---

### 5. Metadata Storage Format

* Struct:

  ```rust
  pub struct StaticHashIndex {
      num_buckets: usize,
      buckets: Vec<Bucket>,
  }
  ```
* Uses `serde::{Serialize, Deserialize}`
  → Metadata is serializable (format depends on `paged_store` usage, not explicitly defined here)

---

### 6. Data Storage Format

Each bucket:

```rust
struct Bucket {
    entries: Vec<BucketEntry>,
    overflow: Vec<OverflowSegment>,
}
```

Overflow:

```rust
struct OverflowSegment {
    entries: Vec<BucketEntry>,
}
```

Entry:

```rust
struct BucketEntry {
    key: IndexKey,
    records: Vec<RecordId>,
}
```

* Primary entries stored first
* Overflow stored as chained segments
* Each entry stores **one key → multiple record IDs**

---

### 7. Hashing / Modulo Function

```rust
(key.hash_code() as usize) % self.num_buckets
```

* Uses `IndexKey.hash_code()`
* Modulo determines bucket index

---

### 8. Collision Handling

* Collisions handled via:

  * Multiple entries per bucket
  * Overflow segments when capacity exceeded

Flow:

1. Try primary bucket
2. If full → check last overflow segment
3. If that is full → create new overflow segment

---

### 9. Operations

#### Search

```rust
bucket.find(key)
```

* Scan primary entries
* Then scan overflow segments
* Return cloned `Vec<RecordId>`

---

#### Insert

```rust
bucket.insert(key, record_id)
```

Steps:

1. If key exists:

   * Append record_id (if not duplicate)
2. Else:

   * Insert into primary if space
   * Else into last overflow segment if space
   * Else create new overflow segment

---

#### Delete

```rust
entry.records.retain(|r| r != record_id)
```

* Removes record_id from matching key
* Returns whether deletion happened
* Does NOT remove empty entries

---

#### Update

* Not explicitly implemented
* Would require:

  * delete(old)
  * insert(new)

---

### 10. Persistence

* Load:

```rust
paged_store::load_entries_stream(path, |key, rid| index.insert(key, rid))
```

* Save:

```rust
paged_store::save_entries(path, self.all_entries()?.into_iter())
```

* Storage is **entry-wise (key, record_id)**

---

### 11. Additional Notes

* Bucket capacity strictly enforced for:

  * Primary entries
  * Each overflow segment
* Structure validation checks:

  * Bucket size constraints
  * Non-empty record lists
* Load factor:

```rust
entry_count / (num_buckets × capacity)
```

---