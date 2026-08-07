---
title: Chain Hash
sidebar_position: 6
---


### Basic Idea

Incremental hash-based indexing using **linear hashing**.
Buckets are split one at a time using a **split pointer (`split_ptr`)** and a **level (`level`)**, avoiding full rehashing. 

* Initial buckets: `N₀`
* Buckets grow dynamically by splitting
* Split triggered when load factor exceeds threshold
* Entries redistributed only for the split bucket

---

### Hashing / Modulo Function

Two hash levels are used:

* Level `l`:

  ```
  h_l(k) = hash(k) mod (N₀ · 2^l)
  ```
* If bucket index `< split_ptr`, use:

  ```
  h_{l+1}(k) = hash(k) mod (N₀ · 2^{l+1})
  ```

Bucket selection:

```
if h_l(k) < split_ptr:
    use h_{l+1}(k)
else:
    use h_l(k)
```



---

### Time Complexity

* **Insert**:
  Average: O(1)
  Worst: O(n) (during split + overflow traversal)

* **Search**:
  Average: O(1)
  Worst: O(n) (overflow chains)

* **Delete**:
  Average: O(1)
  Worst: O(n)

* **Index Creation (load)**:
  O(n) (sequential inserts from paged store)

* **Update**:
  Same as insert/delete

---

### Space Complexity

* Buckets + overflow segments store all entries
* Total space: **O(n)**
* Additional overhead:

  * Overflow segments
  * Dynamic bucket growth

---

### Metadata Storage Format

Stored implicitly via struct serialization:

```
LinearHashIndex {
    level: u32
    split_ptr: usize
    initial_buckets: usize
    buckets: Vec<LHBucket>
    load_factor_threshold: f64
}
```

Saved using:

```
paged_store::save_entries(...)
```

Loaded using:

```
paged_store::load_entries_stream(...)
```



---

### Data Storage Format (Buckets)

Each bucket:

```
LHBucket {
    entries: Vec<LHEntry>
    overflow: Vec<OverflowSegment>
}
```

Entry:

```
LHEntry {
    key: IndexKey
    records: Vec<RecordId>
}
```

Overflow:

```
OverflowSegment {
    entries: Vec<LHEntry>
}
```



---

### Collision Handling

* Primary bucket stores up to `STATIC_HASH_BUCKET_CAPACITY`
* On overflow:

  * Entries added to last overflow segment if space exists
  * Else new overflow segment created
* Multiple overflow segments form a chain

---

### Splitting Mechanism

* Trigger: `load_factor() > threshold`
* Steps:

  1. Create new bucket
  2. Drain entries from bucket at `split_ptr`
  3. Rehash using `h_{l+1}`
  4. Redistribute entries
  5. Increment `split_ptr`
  6. If end of round:

     * `level += 1`
     * `split_ptr = 0` 

---

### Operations

#### Search

* Compute bucket index using `bucket_for`
* Search in:

  * primary entries
  * overflow segments
* Return matching `RecordId`s

---

#### Insert

* Compute bucket index
* Insert into:

  * existing entry if key exists
  * else new entry
* Handle overflow if needed
* Trigger split if load factor exceeded

---

#### Delete

* Locate entry via bucket
* Remove `RecordId` from entry
* Returns success if deletion occurred

---

#### Update

* Not explicitly implemented
* Achieved via:

  * delete + insert

---

### Load Factor

```
load_factor = total_records / (bucket_count × bucket_capacity)
```

---

### Additional Notes from Code

* Duplicate `RecordId`s are avoided per key
* Overflow segments must not exceed capacity
* Structure validation ensures:

  * valid split pointer
  * non-empty records
  * capacity constraints 
