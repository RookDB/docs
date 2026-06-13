---
id: insert_tuple
title: "Insert Tuple"
---
### **Insert Tuple**

**Description:**  
Inserts a tuple into a heap file using the Free Space Map (FSM) to locate a page with sufficient free space. If no suitable page exists, a new page is allocated. The tuple is stored in a slotted page structure and the heap metadata is updated accordingly.

**Function:**  
```rust
pub fn insert_tuple(
    &mut self,
    tuple_data: &[u8],
) -> io::Result<(u32, u32)>
```

**Input:**
- `tuple_data` — Serialized tuple data to be inserted into the heap file.

**Output:**
- Returns `(page_id, slot_id)` on success, representing the physical location of the inserted tuple.
- Returns an `io::Error` if the tuple is invalid, too large, page allocation fails, or insertion cannot be completed.

**Implementation:**
1. Validate that the tuple data is not empty.
2. Verify that the tuple size does not exceed the maximum space available in a page.
3. Calculate the required storage space:
   ```rust
   tuple_size + ITEM_ID_SIZE
   ```
4. Convert the required space into an FSM free-space category.
5. Search the FSM for a page with sufficient free space.
6. If no suitable page exists, allocate a new heap page.
7. Read the selected page from disk.
8. Verify that the page actually contains enough free space.
9. If the page does not have enough space:
   - Update its FSM entry.
   - Retry with another page.
10. Insert the tuple into the page's slotted-page structure.
11. Compute the remaining free space on the page.
12. Write the modified page back to disk.
13. Update the FSM entry with the page's new free-space value.
14. Increment the heap file's tuple count.
15. Persist the updated heap header.
16. Return the tuple location:
   ```rust
   (page_id, slot_id)
   ```

**Internal API Calls:**
- `HeapManager::bytes_to_category(required_bytes)`
  - Converts required free space into an FSM category.

- `fsm.fsm_search_avail(min_category)`
  - Searches the Free Space Map for a page with enough free space.

- `allocate_new_page()`
  - Allocates and initializes a new heap page when no suitable page exists.

- `read_page(&mut self.file_handle, &mut page, page_id)`
  - Loads the selected page into memory.

- `page_free_space(&page)`
  - Calculates available free space on the page.

- `insert_into_page(&mut page, tuple_data)`
  - Inserts the tuple into the slotted-page structure and returns a slot identifier.

- `write_page(&mut self.file_handle, &mut page, page_id)`
  - Writes the modified page back to disk.

- `fsm.fsm_set_avail(page_id, new_free_space, ...)`
  - Updates the page's free-space information in the FSM.

- `update_header_page(&mut self.file_handle, &self.header)`
  - Persists updated heap metadata to disk.

**Files Created/Modified:**
- Heap table file (target data page).
- Heap header page.
- Free Space Map (FSM) pages.

**Storage Updates:**
- Inserts tuple bytes into the selected heap page.
- Creates or updates a slot directory entry.
- Updates page free-space information.
- Updates FSM free-space metadata.
- Increments:
  ```rust
  self.header.total_tuples
  ```
- Persists the updated heap header.

**Notes:**
- The function performs up to three attempts to locate a suitable page before failing.
- Pages that incorrectly advertise free space are automatically corrected in the FSM.
- Newly allocated pages are immediately available for future inserts through the FSM.