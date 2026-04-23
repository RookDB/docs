---
title: Buffer Manager Overview
sidebar_position: 1
---

# Buffer Manager - Complete Overview & Guide

## Introduction

The **Buffer Manager** is a critical component of RookDB's storage subsystem that manages in-memory caching of database pages. It sits between the execution layer and disk storage, significantly reducing I/O operations by maintaining a pool of frequently accessed pages in memory.

### What It Does

- **Reduces Disk I/O**: Keeps frequently accessed pages in memory rather than repeatedly reading from disk
- **Manages Limited Memory**: Intelligently evicts pages when buffer is full using pluggable replacement policies
- **Ensures Correctness**: Tracks page modifications (dirty flag) and ensures they're written to disk
- **Multi-Table Support**: Handles pages from multiple database table files simultaneously
- **Measures Performance**: Tracks cache hits/misses to monitor buffer effectiveness

---

## Architecture at a Glance

```
┌─────────────────────────────────────┐
│   Query Layer / Execution Engine    │
└──────────────┬──────────────────────┘
               │ fetch_page / unpin_page
               │
┌──────────────▼──────────────────────┐
│      Buffer Manager                 │ ◄─ This Component
│   (Caching + Replacement Policy)    │
└──────────────┬──────────────────────┘
               │ read_page / write_page
               │
┌──────────────▼──────────────────────┐
│        Disk Manager                 │
│   (Page Read/Write Operations)      │
└─────────────────────────────────────┘
```
### High-Level Architecture

The Buffer Manager implements a **Buffer Pool**—a fixed-size array of memory frames where each frame holds one database page.

```
┌─────────────────────────────────────────────────────┐
│               Buffer Pool (Total)                   │
│           128 MB (configurable size)                │
├─────────────────────────────────────────────────────┤
│  Reserved Region │ Data Region                      │
│  (Frames 0-128)  │ (Frames 129+)                    │
│  [Catalog Pages] │ [Table Pages - Managed by Policy]│
├─────────────────────────────────────────────────────┤
│ Page | Page | Page | ... | Page | Page | ... | Page │
├─────────────────────────────────────────────────────┤
│  8KB   8KB    8KB          8KB    8KB         8KB   │
└─────────────────────────────────────────────────────┘
```

### Key Concept: Pinning

Pages are managed using a **pin count** mechanism:

```
fetch_page()   → pin_count = 1 (page locked in buffer)
fetch_page()   → pin_count = 2 (same page, multiple users)
unpin_page()   → pin_count = 1 (one user done)
unpin_page()   → pin_count = 0 (eligible for eviction)
```

Only frames with `pin_count = 0` can be evicted when space is needed.

---

## Key Concepts

| Concept | Explanation |
|---------|-------------|
| **PageId** | Unique identifier: (table_name, page_number) |
| **Frame** | Fixed-size memory slot (8 KB) holding one page |
| **Reserved Frames** | Frames 0-128 for catalog pages (never evicted) |
| **Data Frames** | Frames 129+ for table data (managed by replacement policy) |
| **Dirty Page** | Page that has been modified in memory but not flushed to disk |
| **Pin Count** | Number of active users holding a page; >0 means cannot evict |
| **Replacement Policy** | Algorithm that chooses which page to evict (Clock/LRU/LRU-K) |

---

## Documentation Structure

This folder contains specialized documentation for different aspects:

### Core References

| Document | Contents | When to Read |
|----------|----------|--------------|
| **[API Reference](./api-reference.md)** | Complete method signatures and behavior | You need to call a specific method |
| **[Data Structures](./data-structures.md)** | Definition of PageId, FrameMetadata, BufferFrame, etc. | Understanding internal types |
| **[Architecture](./architecture.md)** | System design, frame layout, reservation strategy | How components fit together |
| **[Replacement Policies](./replacement-policies.md)** | Detailed Clock, LRU, and LRU-K algorithms | Choosing/tuning eviction strategy |

### Quick Navigation

**I want to...**
- **Call a method** → See [API Reference](./api-reference.md)
- **Understand a data structure** → See [Data Structures](./data-structures.md)
- **Learn how it works internally** → See [Architecture](./architecture.md)
- **Choose a replacement policy** → See 
[Replacement Policies](./replacement-policies.md)
- **Get an Overview** → Keep reading this document

---

## System Design Overview

The buffer manager divides the buffer pool into two regions:

### Reserved Region (Frames 0-128)

```
┌────────────────────────────────┐
│ RESERVED FRAMES (0-128)        │
│ System Catalog Pages           │
├────────────────────────────────┤
│ pg_database | pg_table         │
│ pg_column | pg_constraint      │
│ pg_index | pg_type             │
└────────────────────────────────┘
```

**Purpose**: Store system catalog metadata that must always be accessible
- Catalog is required for every query (table lookups, schema checks)
- Never evicted, always available
- Takes up ~1 MB of the buffer

### Data Region (Frames 129+)

```
┌────────────────────────────────┐
│ DATA FRAMES (129+)             │
│ User Table Pages               │
├────────────────────────────────┤
│ Table Data Pages (Managed by   │
│ Replacement Policy)            │
└────────────────────────────────┘
```

**Purpose**: Cache actual table data
- Subject to eviction when new pages needed
- Replacement policy decides which pages to evict
- Takes up ~127 MB of the buffer

---

## Typical Workflow

```
1. INITIALIZATION
   ├─ Create BufferPool with chosen replacement policy
   └─ Register all table files

2. DURING QUERY EXECUTION
   ├─ fetch_page("users", 0)?  ← Get page from buffer
   ├─   [Buffer Hit]            ← Already in memory
   ├─     OR
   ├─   [Buffer Miss]           ← Read from disk
   │     ├─ Find free frame (or evict if needed)
   │     └─ Read from disk, place in frame
   │
   ├─ Modify page data
   └─ unpin_page(&page_id, is_dirty)?  ← Release page

3. ON SHUTDOWN
   └─ flush_all()?  ← Write all dirty pages to disk

```

---

## Configuration

The buffer manager is configured via constants in `mod.rs`:

```rust
pub const PAGE_SIZE: usize = 8192;              // 8 KB per page
pub const BUFFER_SIZE: usize = 128 * 1024 * 1024; // 128 MB total
pub const RESERVED_FRAMES: usize = 129;        // Frames 0-128 reserved
```

### Implications

```
Total Frames   = 128 MB / 8 KB = 16,384 frames
Reserved       = 129 frames (~1 MB)
Data Frames    = 16,255 frames (~127 MB)
```

To adjust for your workload:
- **More hot data?** Increase `BUFFER_SIZE`
- **More concurrent queries?** May need larger buffer for pin count headroom
- **Smaller buffer?** Decrease `BUFFER_SIZE` (minimum should fit catalog + working set)

---

## Choosing a Replacement Policy

Three policies are available. Pick based on your workload:

### Clock Policy
- **Best for**: General workloads, sequential access
- **Memory overhead**: Minimal
- **Speed**: Very fast
- **When**: Unsure, or memory-constrained

### LRU Policy
- **Best for**: Working set fits in buffer, strong temporal locality
- **Memory overhead**: Moderate (timestamps per frame)
- **Speed**: Medium
- **When**: Good hit ratios expected, memory available

### LRU-K Policy
- **Best for**: Mixed hot/cold access patterns, cache pollution resistance
- **Memory overhead**: High (K timestamps per frame)
- **Speed**: Slower
- **When**: Need sophisticated eviction behavior

See [Replacement Policies](./replacement-policies.md) for detailed comparison.

---

## Integration Points

### Reading Pages

```rust
// Fetch a page from the buffer (may load from disk)
let page = buffer.fetch_page("users".to_string(), 0)?;

// Use the page

// Release the page
buffer.unpin_page(&page_id, false)?;  // Not modified
```

### Writing Pages

```rust
// Fetch page
let mut page = buffer.fetch_page("users".to_string(), 0)?;

// Modify page

// Release as dirty
buffer.unpin_page(&page_id, true)?;  // Mark for flush
```

### Creating Pages

```rust
// Create a new page in a table
let (page_id, page) = buffer.new_page("users".to_string())?;

// Populate page
// ...

// Mark as dirty (will be flushed)
buffer.unpin_page(&page_id, true)?;
```

---

## Error Handling Guide

### Common Errors and Fixes

```rust

// Error: "All frames are pinned"
// → Cause: Pin count leak (fetch without unpin)
// → Fix: Ensure every fetch_page has matching unpin_page

// Error: Double unpin
// → Cause: unpin called twice on same page
// → Fix: Track pin count, unpin only once per fetch
```

### Pin Count Correctness

**Critical**: Every `fetch_page()` must have matching `unpin_page()`:

```rust
// CORRECT
let page = buffer.fetch_page("users", 0)?;  // +1
buffer.unpin_page(&page_id, true)?;         // -1

// INCORRECT (Leak)
let page = buffer.fetch_page("users", 0)?;  // +1
// ... forgot to unpin ...
// page stays pinned forever!

// INCORRECT (Double fetch)
let page = buffer.fetch_page("users", 0)?;  // +1
let page2 = buffer.fetch_page("users", 0)?; // +2 (same page)
buffer.unpin_page(&page_id, true)?;         // -1 (still pinned!)
```

---

## Performance Monitoring

### Key Metrics

```rust
// Get statistics
let stats = &buffer.stats;

// Hit ratio (0.0 to 1.0, higher is better)
let hit_ratio = stats.hit_ratio();

// Counts
println!("Hits: {}", stats.hit_count);
println!("Misses: {}", stats.miss_count);
println!("Evictions: {}", stats.eviction_count);
println!("Dirty flushes: {}", stats.dirty_flush_count);
```

### Healthy vs Unhealthy

| Metric | Healthy | Problem |
|--------|---------|---------|
| Hit Ratio | > 80% | < 50% (buffer too small?) |
| Evictions | Proportional to workload | Very high (working set > buffer?) |
| Dirty Flushes | Matches write operations | Unexpected patterns? |

### Tuning Based on Metrics

```
IF hit_ratio < 50%:
  → Increase BUFFER_SIZE
  → Try LRU instead of Clock
  → Check if working set fits

IF eviction_count is very high:
  → Increase BUFFER_SIZE
  → Try LRU-K for better selectivity

IF pin_count errors:
  → Check for fetch/unpin mismatches
  → Reduce concurrent queries
  → Increase BUFFER_SIZE for headroom
```

---

## Dirty Page Management

Pages are marked dirty when modified and flushed to disk during eviction or explicit flush:

### Marking Pages

```rust
// Mark page as modified
buffer.unpin_page(&page_id, true)?;  // is_dirty = true
```

### Automatic Flushing

```
When evicting a frame:
  IF frame.metadata.dirty:
    → Write page to disk
    → Clear dirty flag
    → Update statistics
  THEN:
    → Reuse frame for new page
```

### Explicit Flushing

```rust
// Flush single page
buffer.flush_page(&page_id)?;

// Flush all dirty pages
buffer.flush_all()?;
```

**When to flush explicitly**:
- Before shutdown (ensure durability)
- After transaction commit
- Before checkpoints
- Before backup operations

---

## Summary

The Buffer Manager:
- Caches pages in memory to reduce disk I/O
- Manages memory via pluggable replacement policies
- Handles multiple table files
- Ensures data durability with dirty tracking
- Provides pin-based concurrency control
- Tracks performance with comprehensive statistics

Use it correctly by:
- Pinning/unpinning properly
- Marking modifications
- Choosing appropriate policies
- Monitoring performance
