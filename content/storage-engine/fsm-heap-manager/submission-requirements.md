## 4. Algorithms Used

The key algorithms in this phase are:

- FSM tree search for candidate page discovery using category thresholds
- FSM bubble-up updates after free-space changes
- Three-attempt insert fallback strategy for robust progress under fragmentation or stale category mismatch
- Sidecar rebuild from heap pages for recovery

### FSM Search Flow Diagram

![FSM Insertion/Search Flow](/assets/fsm/FSM_Insertion.png)

### FSM Level Mapping Diagram

![FSM Level Tree Structure](/assets/fsm/FSM_Level_Tree_Structure.png)

## 5. Newly Created Data Structures and Their Purpose

| Data Structure | Purpose |
| --- | --- |
| `HeaderMetadata` | Persistent table-level metadata in page 0 |
| `FSMPage` | Encodes free-space tree data inside one FSM page |
| `FSM` | Sidecar manager for search, update, rebuild, and sync |
| `HeapManager` | Core heap API for create/open/insert/get/delete/scan |
| `HeapScanIterator` | Lazy iterator for page-wise sequential scans |

## 6. Backend Functions and Their Purpose

### Heap Layer Functions

- `create`: initialize heap and metadata
- `open`: open heap and reconcile/rebuild FSM
- `insert_tuple`: FSM-guided insert with fallback
- `get_tuple`: coordinate-based lookup
- `delete_tuple`: slot invalidation and metadata update
- `scan`: sequential tuple iteration
- `allocate_new_page`: append and register page state
- `flush`: sync header, heap, and FSM

### FSM Layer Functions

- `open`: open/create sidecar
- `build_from_heap`: reconstruct sidecar from heap
- `fsm_search_avail`: find candidate page by category
- `fsm_set_avail`: update category and propagate maxima
- `fsm_vacuum_update`: reclaim-aware category refresh
- `sync`: persist sidecar changes

### Disk and Page Functions

- `create_page`, `read_page`, `write_page`
- `read_header_page`, `update_header_page`, `read_all_pages`
- `init_page`, `page_free_space`, `get_tuple_count`, `get_slot_entry`


## 8. Benchmark Results (Available)

Representative results from the latest benchmark report include:

- strong small and large insert throughput
- high point lookup and sequential scan throughput
- low FSM rebuild latency
- correctness checks such as scan count parity and oversized tuple rejection

Canonical outputs are published under `benchmark_runs/`, including JSON, CSV, and comparison artifacts.

## 9. Potential Future Work
Planned and natural next steps include:
- full compaction-aware insert path
- richer fragmentation reclamation workflows
- expanded type support
- concurrency and contention improvements
- improved benchmark methodology with repeated runs and median/p95 reporting