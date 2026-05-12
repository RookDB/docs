# Table Layout

The first page of the file is reserved as the **Table Header**. Within this page, only the first 4 bytes are used to store the total number of pages that contain tuple data. The remaining bytes in the header page are currently unused.

All subsequent pages are data pages used to store tuples.

Each table file is logically divided into two distinct regions. The first region is a fixed-size table header occupying the initial 8 KB of the file. This header stores metadata required for table management, currently stores only the total number of allocated pages. The second region consists of a sequence of fixed-size data pages, each 8 KB in size, which store tuple data along with associated slot metadata.

![Logical Layout of a Table File](/assets/Table-Architecture.png)

The table metadata is stored in **Page 0** of the table file as a fixed-size **20-byte `HeaderMetadata`** structure.

| Field | Type | Meaning |
| --- | --- | --- |
| `page_count` | `u32` | Total number of heap pages, including page 0 |
| `fsm_page_count` | `u32` | Total number of FSM pages currently tracked |
| `total_tuples` | `u64` | Total inserted tuples |
| `last_vacuum` | `u32` | Unix timestamp of the last vacuum-style update |

**Total Size:** `20 bytes`


`HeaderMetadata::new()` starts with `page_count = 1`, `fsm_page_count = 0`, `total_tuples = 0`, and `last_vacuum = 0`. When a heap is created, `HeapManager::create()` writes the header page, creates the first data page, and then synchronizes the FSM state.