---
id: delete_tuple
title: "Delete Tuple"
---
### **Delete Tuple**

**Description:**  
Deletes a tuple from a heap file by marking its slot entry as deleted. The tuple is not physically removed from the page; instead, its slot directory entry is invalidated, allowing future maintenance operations (e.g., VACUUM) to reclaim space.

**Function:**  
```rust
pub fn delete_tuple(
    &mut self,
    page_id: u32,
    slot_id: u32,
) -> io::Result<u32>
```

**Input:**
- `page_id` — Identifier of the page containing the tuple.
- `slot_id` — Slot identifier of the tuple within the page.

**Output:**
- Returns the number of bytes freed (`u32`) on success.
- Returns an `io::Error` if the page or slot is invalid, or if a page read/write operation fails.

**Implementation:**
1. Validate that `page_id` is within the heap file's page range.
2. Read the target page from disk.
3. Retrieve the tuple's slot directory entry.
4. Compute the number of bytes freed:
   ```rust
   tuple_length + ITEM_ID_SIZE
   ```
5. Mark the slot as deleted by setting:
   ```rust
   offset = 0
   length = 0
   ```
6. Read the page's `lower` and `upper` pointers.
7. If the deleted tuple occupies the current upper boundary, reclaim contiguous data space by adjusting `upper`.
8. If the deleted slot is the last slot entry in the slot directory, reclaim slot array space by adjusting `lower`.
9. Write the modified page back to disk.
10. Decrement the heap file's tuple count.
11. Persist the updated heap header.
12. Return the number of freed bytes.

**Internal API Calls:**
- `read_page(&mut self.file_handle, &mut page, page_id)`
  - Loads the target page from disk into memory.

- `get_slot_entry(&page, slot_id)`
  - Retrieves the tuple offset and length from the slot directory.

- `get_tuple_count(&page)`
  - Returns the number of slot entries in the page.

- `write_page(&mut self.file_handle, &mut page, page_id)`
  - Persists the modified page back to disk.

- `update_header_page(&mut self.file_handle, &self.header)`
  - Writes the updated heap header metadata to disk.

**Files Created/Modified:**
- Heap table file containing the target page.
- Heap header page.

**Storage Updates:**
- Marks the tuple's slot directory entry as deleted:
  ```rust
  offset = 0
  length = 0
  ```
- Updates page metadata (`lower` and/or `upper`) when contiguous space can be reclaimed.
- Decrements:
  ```rust
  self.header.total_tuples
  ```
- Updates the heap header on disk.

**Notes:**
- The tuple is logically deleted but not physically removed from the page.
- Free Space Map (FSM) entries are not updated during deletion because contiguous free space does not necessarily increase.
- Space is fully reclaimed later through page compaction or VACUUM operations.