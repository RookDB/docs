# Buffer Replacement Policies (Implementation-Level Explanation)

This document explains the **actual implementation** of buffer replacement policies in RookDB,
including **code-level behavior** from:

- `policy.rs`
- `lru.rs`
- `clock.rs`
- `lru_k.rs`

The buffer manager relies on these policies to select a **victim frame** when the buffer pool is full.

---

# 1. Policy Trait (policy.rs)

All replacement policies implement a common interface.

```rust
pub trait ReplacementPolicy {
    fn record_access(&mut self, frame_id: usize);
    fn victim(&mut self, frames: &mut [Frame]) -> Option<usize>;
}
```

## Explanation

### `record_access(frame_id)`
- Called whenever a page is:
  - Fetched
  - Hit in buffer
- Updates internal metadata of the policy

### `victim(frames)`
- Selects a frame for eviction
- Must:
  - Skip pinned frames (`pin_count > 0`)
  - Return `None` if no frame is evictable

---

# 2. Frame Interaction (Important)

All policies operate on `Frame`.

Typical structure:

```rust
pub struct Frame {
    pub page_id: Option<u32>,
    pub pin_count: u32,
    pub is_dirty: bool,
}
```

## Eviction Rules

```text
pin_count > 0  → cannot evict
pin_count == 0 → eligible
```

---

# 3. LRU Policy (lru.rs)

## Core Idea

Evict the **least recently used frame**.

---

## Internal State (Typical)

```rust
pub struct LRU {
    pub order: Vec<usize>, // stores frame_ids
}
```

- Front → most recently used
- Back → least recently used

---

## record_access()

```rust
fn record_access(&mut self, frame_id: usize) {
    self.order.retain(|&id| id != frame_id);
    self.order.insert(0, frame_id);
}
```

### Explanation

1. Remove frame if already present
2. Insert at front (most recent)

---

## victim()

```rust
fn victim(&mut self, frames: &mut [Frame]) -> Option<usize> {
    for &frame_id in self.order.iter().rev() {
        if frames[frame_id].pin_count == 0 {
            return Some(frame_id);
        }
    }
    None
}
```

### Explanation

- Traverse from **least recent → most recent**
- Return first unpinned frame

---

## Diagram

```text
MRU → [2, 5, 1, 7, 3] ← LRU

Eviction scan →
3 → if unpinned → victim
```

---

# 4. Clock Policy (clock.rs)

## Core Idea

Efficient approximation of LRU using:
- Circular pointer
- Reference bit

---

## Internal State

```rust
pub struct Clock {
    pub hand: usize,
    pub ref_bits: Vec<bool>,
}
```

---

## record_access()

```rust
fn record_access(&mut self, frame_id: usize) {
    self.ref_bits[frame_id] = true;
}
```

---

## victim()

```rust
fn victim(&mut self, frames: &mut [Frame]) -> Option<usize> {
    let n = frames.len();

    for _ in 0..(2 * n) {
        let i = self.hand;

        if frames[i].pin_count == 0 {
            if !self.ref_bits[i] {
                self.hand = (self.hand + 1) % n;
                return Some(i);
            } else {
                self.ref_bits[i] = false;
            }
        }

        self.hand = (self.hand + 1) % n;
    }

    None
}
```

---

## Explanation

1. Check frame at `hand`
2. If:
   - `ref_bit = 1` → give second chance → set to 0
   - `ref_bit = 0` → evict
3. Move pointer circularly

---

## Diagram

```text
Frames:   [0] [1] [2] [3]
Ref bits:  1   0   1   0
             ↑
           hand

Step:
0 → reset
1 → evict
```

---

# 5. LRU-K Policy (lru_k.rs)

## Important Note

**K is hardcoded to 3 in this implementation**

```rust
const K: usize = 3;
```

---

## Core Idea

Track **last K accesses per frame** and evict based on:

> Largest backward K-distance

---

## Internal State

```rust
use std::collections::HashMap;

pub struct LRUK {
    pub history: HashMap<usize, Vec<u64>>,
    pub current_time: u64,
}
```

---

## record_access()

```rust
fn record_access(&mut self, frame_id: usize) {
    self.current_time += 1;

    let entry = self.history.entry(frame_id).or_insert(Vec::new());
    entry.push(self.current_time);

    if entry.len() > K {
        entry.remove(0); // keep only last K
    }
}
```

---

## Explanation

- Maintain **timestamp history**
- Always keep last **3 accesses**
- Older accesses are removed

---

## victim()

```rust
fn victim(&mut self, frames: &mut [Frame]) -> Option<usize> {
    let mut victim = None;
    let mut max_distance = 0;

    for (frame_id, times) in &self.history {
        if frames[*frame_id].pin_count > 0 {
            continue;
        }

        let distance = if times.len() < K {
            u64::MAX
        } else {
            self.current_time - times[0]
        };

        if distance > max_distance {
            max_distance = distance;
            victim = Some(*frame_id);
        }
    }

    victim
}
```

---

## Explanation

### Case 1: Less than K accesses

```rust
if times.len() < K {
    distance = ∞
}
```

Frame is considered **cold** → high eviction priority

---

### Case 2: K accesses available

```rust
distance = current_time - kth_last_access
```
 Larger distance → less recently used

---

## Example (K = 3)

```text
Frame histories:

F1: [5, 10, 20]
F2: [3, 8, 15]
F3: [12, 18]   (less than K)

Current time = 25
```

### Compute distance

```text
F1 → 25 - 5  = 20
F2 → 25 - 3  = 22
F3 → ∞       (highest priority)
```
Victim = F3

---

## Diagram

```text
Time →
|----|----|----|----|----|----|----|

F1:    •     •       •
F2:  •     •      •
F3:       •     •

Evict → frame with oldest 3rd access
```

---

# 6. Integration with Buffer Pool

## Flow

```text
fetch_page(page_id):

    if page exists:
        policy.record_access(frame_id)

    else:
        victim = policy.victim(frames)

        if victim.is_dirty:
            write_page()

        replace victim
        load new page
```

---

# 7. Final Notes

- All policies:
  - Ignore pinned frames
  - Work on frame indices
- Buffer manager ensures:
  - Dirty pages flushed before eviction

---

# 8. Architectural Context

These policies belong to the **Buffer Manager Layer**, which minimizes disk I/O
and manages in-memory pages efficiently :contentReference[oaicite:0]{index=0}.


