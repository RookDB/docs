---
title: Replacement Policies
sidebar_position: 1
---

# Buffer Manager Replacement Policies

## Overview

The Buffer Manager in RookDB is responsible for managing the buffer pool, which caches database pages in memory to reduce disk I/O operations. A critical component of the buffer manager is the **replacement policy**, which determines which page to evict from the buffer when space is needed for a new page. This documentation provides a detailed explanation of the replacement policies implemented in RookDB, including their algorithms, code implementations, and integration with the buffer pool.

The buffer manager supports three replacement policies:
1. **Clock Policy** - A simple, efficient approximation of LRU.
2. **LRU (Least Recently Used) Policy** - Evicts the least recently accessed page.
3. **LRU-K Policy** - An advanced policy that considers the history of the last K accesses.

---

## 1. Replacement Policy Trait

All replacement policies implement the `ReplacementPolicy` trait, which defines the interface for selecting victims and recording accesses.

### Trait Definition

```rust
pub trait ReplacementPolicy {
    // Select a victim frame for eviction
    fn victim(&mut self, frames: &mut Vec<BufferFrame>) -> Option<usize>;

    // Called whenever a frame is accessed
    fn record_access(&mut self, frame_id: usize);
}
```

### Trait Methods Explained

| Method | Purpose | Returns |
|--------|---------|---------|
| `victim(&mut self, frames: &mut Vec<BufferFrame>)` | Selects a frame index to evict from the buffer. Must skip pinned frames (pin_count > 0). Returns None if no victim can be found. | `Option<usize>` - Frame index or None |
| `record_access(&mut self, frame_id: usize)` | Called whenever a frame is accessed (buffer hit or page load). Updates the policy's internal state to track access patterns. | `()` - No return value |

### Key Properties

- **Frame Independence**: Policies operate on frame indices relative to `RESERVED_FRAMES` (system frames).
- **Pin Count Awareness**: All policies must respect pin counts and never evict pinned frames.
- **Stateful**: Each policy maintains internal state to track access patterns.
- **Trait Objects**: Used as `Box<dyn ReplacementPolicy>` in BufferPool for runtime polymorphism.

---

## 2. Clock Replacement Policy

### Algorithm Overview

The Clock policy is a low-overhead, circular sweep algorithm that approximates LRU behavior. It uses a clock hand pointer that rotates through frames, giving each frame a "second chance" before eviction.

**Key Concept:**
- Each frame has a `usage_count` (0 or 1 bit).
- A clock hand sweeps through frames in circular order.
- When a frame is accessed, its `usage_count` is set to 1.
- On eviction, frames with `usage_count == 0` are selected first.
- Frames with `usage_count == 1` get a second chance (set to 0) and the hand continues.

### How it Works: Step by Step

1. **Page Access** → `usage_count` set to 1 in BufferPool
2. **Need Eviction** → Clock policy victim selection begins
3. **Clock Hand Sweep** → Examine current frame at hand position
4. **Check Frame State**:
   - If **pinned** → Skip to next frame
   - If **not pinned AND usage_count == 0** → Evict this frame
   - If **not pinned AND usage_count == 1** → Give second chance (set to 0), move hand
5. **Hand Movement** → `hand = (hand + 1) % num_frames`
6. **Termination** → After scanning 2 × buffer_size frames, return None (all pinned)

### Advantages

- **Minimal Memory Overhead**: Only one bit per frame (usage_count)
- **Fast Access Recording**: O(1) operation
- **Scalable**: Works well with large buffers
- **Cache-Friendly**: Sequential access pattern
- **Good Practical Performance**: Acceptable hit ratio

### Disadvantages

- **Less Accurate than LRU**: May evict recently used pages
- **Correlated Accesses**: Can cause thrashing with certain patterns
- **Second Chance Bias**: Heavily accessed pages get repeated chances

### Code Implementation

```rust
pub struct ClockPolicy {
    pub hand: usize,  // Current position in the circular buffer
}

impl ClockPolicy {
    /// Create a new Clock policy with hand at position 0
    pub fn new() -> Self {
        Self { hand: 0 }
    }
}

impl ReplacementPolicy for ClockPolicy {

    fn victim(&mut self, frames: &mut Vec<BufferFrame>) -> Option<usize> {
        let n = frames.len();
        let mut scanned = 0;

        // Scan up to 2 full rotations
        while scanned < 2 * n {
            let frame = &mut frames[self.hand];

            // Step 1: Skip pinned frames (actively in use)
            if frame.metadata.pin_count == 0 {
                
                // Step 2: If usage_count is 0, this frame is a victim
                if frame.metadata.usage_count == 0 {
                    let victim = self.hand;
                    self.hand = (self.hand + 1) % n;  // Advance for next eviction
                    return Some(victim);
                } else {
                    // Step 3: Give second chance - clear the usage bit
                    frame.metadata.usage_count = 0;
                }
            }

            // Step 4: Move hand to next frame
            self.hand = (self.hand + 1) % n;
            scanned += 1;
        }

        // All frames are pinned
        None
    }

    fn record_access(&mut self, _frame_id: usize) {
        // NO-OP: Access recording is handled directly in BufferPool::fetch_page
        // BufferPool sets frame.metadata.usage_count = 1 on every access
    }
}
```
### Implementation Details

| Detail                      | Explanation                                      |
|-----------------------------|--------------------------------------------------|
| `hand: usize`               | Circular pointer to current frame being examined |
| `scanned < 2 * n`           | Allow up to 2 complete rotations before giving up |
| `pin_count == 0`            | Only consider unpinned frames for eviction       |
| `usage_count == 0`          | Immediate victim candidate                       |
| `usage_count = 0`           | Second chance mechanism                          |
| `hand = (hand + 1) % n`     | Circular wraparound                              |
| `record_access`             | No-op; usage tracking in `BufferPool`            |


---

## 3. LRU (Least Recently Used) Replacement Policy

### Algorithm Overview

LRU evicts the page that has not been accessed for the longest time. It maintains a logical timestamp for each frame, updating it on every access. When eviction is needed, the frame with the smallest (oldest) timestamp is selected.

**Key Concept:**
- Each frame gets a timestamp on every access
- Global `current_time` counter increments on each access
- Victim = frame with minimum timestamp
- Skip pinned frames

### How it Works: Step by Step

1. **Page Access** → `current_time++`, `timestamps[frame_id] = current_time`
2. **Need Eviction** → Scan all frames to find minimum timestamp
3. **Find Victim**:
   - For each **unpinned** frame:
     - Get its timestamp (0 if never accessed)
     - Track the minimum timestamp seen
   - Select frame with minimum timestamp
4. **Return** → Frame index with oldest access time

### Advantages

- **Optimal for Sequential Workloads**: Excellent locality exploitation
- **Simple and Intuitive**: Easy to understand and reason about
- **Good General Performance**: Works well for most workloads
- **Predictable**: Deterministic behavior based on access history
- **Industry Standard**: Widely used in real databases

### Disadvantages

- **Higher Memory Overhead**: One u64 timestamp per frame (~8 bytes)
- **O(n) Victim Selection**: Linear scan through all frames
- **Sequential Flooding**: Vulnerable to full-scan access patterns
- **No Distinction**: All accesses weighted equally regardless of pattern

### Code Implementation

```rust
pub struct LRUPolicy {
    timestamps: HashMap<usize, u64>,  // frame_id -> last access time
    current_time: u64,                // global logical clock
}

impl LRUPolicy {
    /// Create a new LRU policy
    pub fn new() -> Self {
        Self {
            timestamps: HashMap::new(),
            current_time: 0,
        }
    }
}

impl ReplacementPolicy for LRUPolicy {

    fn victim(&mut self, frames: &mut Vec<BufferFrame>) -> Option<usize> {
        let mut victim_index = None;
        let mut oldest_time = u64::MAX;

        // Scan all frames to find the least recently used
        for (i, frame) in frames.iter().enumerate() {
            
            // Step 1: Skip pinned frames
            if frame.metadata.pin_count != 0 {
                continue;
            }

            // Step 2: Get timestamp for this frame (0 if never accessed)
            let time = *self.timestamps.get(&i).unwrap_or(&0);
            
            // Step 3: Track the minimum timestamp
            if time < oldest_time {
                oldest_time = time;
                victim_index = Some(i);
            }
        }

        // Return the frame with the oldest timestamp
        victim_index
    }

    fn record_access(&mut self, frame_id: usize) {
        // Step 1: Increment global time
        self.current_time += 1;
        
        // Step 2: Record this frame's access with the new timestamp
        self.timestamps.insert(frame_id, self.current_time);
    }
}
```
### Implementation Details

| Detail                         | Explanation                                              |
|--------------------------------|----------------------------------------------------------|
| `timestamps: HashMap<usize, u64>` | Maps `frame_id` to last access timestamp                |
| `current_time: u64`            | Global logical clock, increments on each access          |
| `u64::MAX`                     | Used as initial "oldest_time" for comparison             |
| `unwrap_or(&0)`                | Frames never accessed have timestamp `0` (evicted first) |
| Linear scan                    | O(n) where n = number of frames                          |
| HashMap insert                 | Constant-time timestamp update                           |
---

## 4. LRU-K Replacement Policy

### Algorithm Overview

LRU-K is an advanced policy that considers the history of the last K accesses. Instead of just the last access time, it tracks the K most recent accesses and uses the "backward K-distance" metric for eviction decisions.

**Key Concepts:**
- **Backward K-Distance**: For a frame with ≥ K accesses, it's the time since the K-th most recent access
- **Infinite Distance**: Frames with < K accesses get distance = ∞ (low eviction priority)
- **Access History**: Each frame maintains a vector of its last K access timestamps
- **FIFO Overflow**: When history exceeds K entries, the oldest is removed

---
### Why LRU-K Matters

**Problem with LRU:**
- Sequential scan of 1000 pages → all get recent timestamps  
- These displace cached hot data despite being accessed only once!  

**Solution with LRU-K:**
- Hot page: accessed K times (backward K-distance = large)  
- Sequential page: accessed once (backward K-distance = 0 or not counted)  
- **Result:** Hot page is protected!  

---

### How it Works: Step by Step

1. **Page Access** → Add timestamp to frame's history, keep only last K  
2. **Calculate Distance** → `current_time - history[0]` (if K accesses exist)  
3. **Handle New Pages** → Frames with `< K` accesses get distance = ∞  
4. **Select Victim** → Frame with **MAXIMUM** backward K-distance  
5. **Eviction** → Evict the least "K-used" page  

---
### Advantages

- **Sequential Flooding Resistant**: Protects repeatedly accessed pages
- **Intelligent History Tracking**: Considers patterns, not just recency
- **Configurable**: K parameter tunes sensitivity
- **Workload Adaptive**: Handles mixed access patterns well
- **Cache Pollution Prevention**: Doesn't evict hot data for sequential scans

### Disadvantages

- **Highest Memory Overhead**: K timestamps per frame (K × 8 bytes)
- **Complex Implementation**: More code, harder to debug
- **Parameter Tuning**: K value must be chosen for workload
- **Vector Operations**: Removing oldest timestamp is O(K)
- **O(n) Victim Selection**: Still must scan all frames


### Code Implementation

```rust
pub struct LRUKPolicy {
    k: usize,                              // Number of accesses to track
    current_time: u64,                     // Global logical clock
    history: HashMap<usize, Vec<u64>>,    // frame_id -> last K access times
}

impl LRUKPolicy {
    /// Create a new LRU-K policy with K accesses to track
    pub fn new(k: usize) -> Self {
        Self {
            k,
            current_time: 0,
            history: HashMap::new(),
        }
    }

    /// Calculate backward K-distance for a frame
    fn backward_k_distance(&self, frame_id: usize) -> u64 {
        match self.history.get(&frame_id) {
            Some(timestamps) => {
                if timestamps.len() < self.k {
                    u64::MAX
                } else {
                    let kth_time = timestamps[0];
                    self.current_time - kth_time
                }
            }
            None => u64::MAX,
        }
    }
}

impl ReplacementPolicy for LRUKPolicy {

    fn victim(&mut self, frames: &mut Vec<BufferFrame>) -> Option<usize> {
        let mut victim_index = None;
        let mut max_distance = 0;

        for (i, frame) in frames.iter().enumerate() {
            if frame.metadata.pin_count != 0 {
                continue;
            }

            let distance = self.backward_k_distance(i);
            if victim_index.is_none() || distance > max_distance {
                max_distance = distance;
                victim_index = Some(i);
            }
        }

        victim_index
    }

    fn record_access(&mut self, frame_id: usize) {
        self.current_time += 1;

        let entry = self.history.entry(frame_id).or_insert(Vec::new());
        entry.push(self.current_time);

        if entry.len() > self.k {
            entry.remove(0);
        }
    }
}
```
### Implementation Details

Note : `K` is hardcoded to 3 in the implementation.

| Detail                               | Explanation                                                  |
|--------------------------------------|--------------------------------------------------------------|
| `k: usize`                           | Number of recent accesses to track per frame                 |
| `history: HashMap<usize, Vec<u64>>`  | Maps `frame_id` to vector of last K timestamps               |
| `current_time: u64`                  | Global logical clock                                         |
| `u64::MAX`                           | Used to represent infinite distance (`< K` accesses)         |
| `history[0]`                         | Oldest timestamp among the K most recent (kth access)        |
| `entry.remove(0)`                    | Remove oldest when history exceeds K (O(K) cost)             |
| Maximum selection                    | Unlike LRU (minimum), we select MAXIMUM distance             |

---

## 5. Integration with Buffer Pool

### Buffer Pool Architecture

The `BufferPool` struct uses a replacement policy to manage page evictions when no free frames are available.

```rust
pub struct BufferPool {
    pub frames: Vec<BufferFrame>,
    pub page_table: HashMap<PageId, usize>,
    pub files: HashMap<String, File>,
    pub num_frames: usize,
    pub policy: Box<dyn ReplacementPolicy>,
    pub stats: BufferStats,
}
```

The `BufferPool` uses the replacement policy through the `policy` field, which is a `Box<dyn ReplacementPolicy>`.

### Key Integration Points

1. **Policy Selection:** The buffer pool is initialized with a chosen policy:

```rust
pub fn new(policy: Box<dyn ReplacementPolicy>) -> Self { ... }
```

2. **Access Recording:** In `fetch_page`, after finding or loading a page:

```rust
if frame_index >= RESERVED_FRAMES {
    self.policy.record_access(frame_index - RESERVED_FRAMES);
}
```

> **Note:** Only non-reserved frames are managed by the policy.

3. **Victim Selection:** In `fetch_page`, when no free frame is available:

```rust
let victim = self.policy.victim(&mut self.frames);
```

4. **Frame Indexing:** Policies work with frame indices relative to `RESERVED_FRAMES`.  
The buffer has reserved frames `(0 to RESERVED_FRAMES-1)` for system pages, and the rest are managed by the policy.
---

## 6. Summary Table

### Replacement Policies At a Glance

| Aspect | Clock | LRU | LRU-K |
|--------|-------|-----|-------|
| **Algorithm** | Circular sweep | Min timestamp | Max K-distance |
| **Victim Selection** | O(1-2n) | O(n) | O(n) |
| **Access Record** | O(1) | O(1) | O(K) |
| **Implementation** | Simple | Medium | Complex |
| **Sequential Immunity** | No | No | Yes |

---

## Conclusion

The Buffer Manager's replacement policies provide a spectrum of options from simple and efficient to sophisticated and adaptive. The choice of policy significantly impacts database performance. Clock offers minimal overhead, LRU provides excellent general-purpose performance, and LRU-K protects against cache pollution in scan-heavy workloads.

The modular design with the `ReplacementPolicy` trait allows RookDB to remain flexible, enabling easy policy switching and future extensions without modifying the core buffer pool logic.

