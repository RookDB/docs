# Buffer Manager Data Structures

This document describes the key data structures used in the Buffer Manager component of RookDB.

## PageId

Represents a unique identifier for a page in the database.

```rust
pub struct PageId {
    pub table_name: String,
    pub page_number: u32,
}
```

- `table_name`: The name of the table this page belongs to.
- `page_number`: The page number within the table.

## FrameMetadata

Contains metadata associated with a buffer frame.

```rust
pub struct FrameMetadata {
    pub page_id: Option<PageId>, // which page currently resides in this frame
    pub dirty: bool,             // whether page modified
    pub pin_count: u32,          // number of active users
    pub usage_count: u32,        // used by clock policy
    pub last_used: u64,          // timestamp for LRU
}
```

- `page_id`: The ID of the page currently stored in this frame, or `None` if empty.
- `dirty`: Indicates if the page has been modified since loading.
- `pin_count`: Number of active users currently accessing this frame.
- `usage_count`: Used by the Clock replacement policy to track usage.
- `last_used`: Timestamp of the last access, used by LRU policies.

## BufferFrame

Represents a single frame in the buffer pool, containing a page and its metadata.

```rust
pub struct BufferFrame {
    pub page: Page,
    pub metadata: FrameMetadata,
}
```

- `page`: The actual page data stored in memory.
- `metadata`: Metadata associated with this frame.

## BufferStats

Tracks statistics for buffer pool performance.

```rust
pub struct BufferStats {
    pub hit_count: u64,
    pub miss_count: u64,
    pub eviction_count: u64,
    pub dirty_flush_count: u64,
}
```

- `hit_count`: Number of times a requested page was found in the buffer.
- `miss_count`: Number of times a requested page was not in the buffer.
- `eviction_count`: Number of times a page was evicted from the buffer.
- `dirty_flush_count`: Number of times a dirty page was written to disk.

## BufferPool

The main buffer pool structure that manages frames, page mapping, and replacement policies.

```rust
pub struct BufferPool {
    pub frames: Vec<BufferFrame>,
    pub page_table: HashMap<PageId, usize>,
    pub files: HashMap<String, File>, // MULTI-FILE SUPPORT
    pub num_frames: usize,
    pub policy: Box<dyn ReplacementPolicy>,
    pub stats: BufferStats,
}
```

- `frames`: Vector of buffer frames containing the actual page data.
- `page_table`: Maps page IDs to frame indices for quick lookup.
- `files`: Maps file names to open file handles for multi-file support.
- `num_frames`: Total number of frames in the buffer pool.
- `policy`: The replacement policy used for eviction decisions.
- `stats`: Statistics tracking buffer performance.

## ReplacementPolicy Trait

Defines the interface for page replacement policies.

```rust
pub trait ReplacementPolicy {
    // Select a victim frame for eviction
    fn victim(&mut self, frames: &mut Vec<BufferFrame>) -> Option<usize>;

    // Called whenever a frame is accessed
    fn record_access(&mut self, frame_id: usize);
}
```

## ClockPolicy

Implements the Clock (Second Chance) page replacement algorithm.

```rust
pub struct ClockPolicy {
    pub hand: usize,
}
```

- `hand`: Current position of the clock hand in the frame list.

## LRUPolicy

Implements the Least Recently Used (LRU) page replacement algorithm.

```rust
pub struct LRUPolicy {
    timestamps: HashMap<usize, u64>,
    current_time: u64,
}
```

- `timestamps`: Maps frame IDs to their last access timestamps.
- `current_time`: Global timestamp counter for access ordering.

## LRUKPolicy

Implements the LRU-K page replacement algorithm, which considers the K most recent accesses.

```rust
pub struct LRUKPolicy {
    k: usize,
    current_time: u64,
    history: HashMap<usize, Vec<u64>>, // frame_id -> access timestamps
}
```

- `k`: The number of recent accesses to consider.
- `current_time`: Global timestamp counter.
- `history`: Maps frame IDs to vectors of their recent access timestamps.
