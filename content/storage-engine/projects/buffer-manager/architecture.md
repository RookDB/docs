---
title: Architecture
sidebar_position: 1
---

# Buffer Manager Architecture (RookDB)

This document provides a **detailed architectural overview** of the Buffer Manager in RookDB.
It focuses on:

- Structural design
- Memory layout
- Frame organization
- Reservation strategy
- Interaction flow


---

# 1. Role in System Architecture

The Buffer Manager is part of the **Storage Manager Layer**, positioned between:

```text
        Query Layer / Execution Engine
                      ↓
              Buffer Manager
                      ↓
                 Disk Storage
```

## Responsibility

- Maintain in-memory cache of pages
- Reduce disk I/O
- Provide controlled access to pages
- Manage eviction and replacement

---

# 2. High-Level Design

The Buffer Manager is implemented as a **Buffer Pool**, which is:

> A fixed-size array of memory frames

---

## Core Structure

```rust
struct BufferPool {
    pub frames: Vec<BufferFrame>,
    pub page_table: HashMap<PageId, usize>,
    pub files: HashMap<String, File>, 
    pub num_frames: usize,
    pub policy: Box<dyn ReplacementPolicy>,
    pub stats: BufferStats,
}
```

---

## Conceptual View

```text
+---------------------------------------------------+
|                  Buffer Pool                      |
+---------------------------------------------------+
| Frame 0 | Frame 1 | Frame 2 | ... | Frame N-1     |
+---------------------------------------------------+
```

Each frame can hold **one page**.

---

# 3. Frame Abstraction

Each frame represents a **slot in memory**.

---

## Conceptual Frame Layout

```text
+----------------------------------+
| Page Data (8 KB)                 |
+----------------------------------+
| Frame Metadata :                 |
| page_id                          |
| pin_count                        |
| dirty                            |
| usage_count                      |
| last_used                        |
+----------------------------------+
```

---

## Key Properties

- Fixed-size (aligned with page size: 8 KB)
- Contains:
  - Page data
  - Control metadata

---

# 4. Page Table Mapping

To locate pages quickly:

```text
Page Table (HashMap)

PageId → FrameId
```

---

## Diagram

```text
Page Table:

[Page 5] → Frame 2
[Page 8] → Frame 7
[Page 1] → Frame 0
```

---

## Purpose

- Avoid scanning buffer pool
- Enable O(1) lookup

---

# 5. Buffer Pool Partitioning

The buffer pool is **logically divided into two regions**:

---

## 5.1 Reserved Region (System Pages)

```text
[ RESERVED FRAMES ]
Frame 0 → Frame 127
```

---

## 5.2 General Region (User Pages)

```text
[ GENERAL FRAMES ]
Frame 127 → Frame (N-1)
```

---

## Full Layout

```text
+-------------------------------------------------------+
| RESERVED | RESERVED | ... | GENERAL | GENERAL | ...    |
| Frames   | Frames   |     | Frames  | Frames  |        |
+-------------------------------------------------------+
 0        ...       127    128       ...         N-1
```

---

# 6. Reservation Strategy

## Key Design Decision

A fixed number of frames are **reserved exclusively** for:

- Catalog pages
- System metadata
- Frequently accessed internal structures

---

## Constant Definition (Conceptual)

```rust
const RESERVED_FRAMES: usize = 128;
```

---

## Why Reservation?

### 1. Prevent System Page Eviction

```text
Without reservation:
→ Catalog pages may get evicted
→ Leads to repeated disk reads
→ Performance degradation
```

---

### 2. Ensure Metadata Availability

- Catalog is required for:
  - Table lookup
  - Schema resolution

---

### 3. Isolation from User Workload

```text
User queries → heavy page access
System pages → must remain stable
```

---

# 7. Reserved vs General Pool Behavior

## Reserved Region

```text
- Preloaded at startup
- Not part of general eviction policy
- Dedicated for catalog/system pages
- Have special eviction policy implemented

```

---

## General Region

```text
- Used for table data pages
- Managed by replacement policy
- Subject to eviction
```

---

## Diagram

```text
                BUFFER POOL

+-------------------------------------------------------+
| Reserved Zone           | General Zone                    |
|------------------------|----------------------------------|
| Catalog Pages           | Table Pages                     |
| System Metadata         | User Data                       |
| Special Eviction        | Eviction Enabled                |
+-------------------------------------------------------+
```

---

# 8. Access Flow Architecture

## Data Page Fetch Flow

```text
Request Page (page_id)
          |
          v
   Check Page Table
      /      \
     /        \
   Hit        Miss
    |           |
    v           v
 Return    Select Victim
  Page          |
                v
        Replace Frame
                |
                v
           Load Page
```

---

# 9. Victim Selection Scope

Important Architectural Constraint

```text
Victim selection ONLY applies to:

→ General Region
→ Frames [RESERVED_FRAMES ... N-1]
```

---

## Diagram

```text
Frames:

[0 ... 127]       → Reserved (excluded)
[128 ... N-1]     → Eligible for eviction
```

---

# 10. Memory Layout Perspective

## Logical Memory View

```text
RAM
│
├── Buffer Pool
│   ├── Reserved Frames (128)
│   │   ├── Catalog Page 0
│   │   ├── Catalog Page 1
│   │   └── ...
│   │
│   └── General Frames
│       ├── Table Page A
│       ├── Table Page B
│       └── ...
│
└── Other Runtime Memory
```

---

# 11. Preloading Mechanism (Architectural)

At system startup:

```text
1. Initialize buffer pool
2. Load catalog pages
3. Place them in reserved frames
```

---

## Diagram

```text
Startup:

Disk (catalog.json)
        ↓
Load Pages
        ↓
Store in Reserved Frames
```

---

# 12. Concurrency & Safety (Conceptual)

Although not implementation-specific:

- Frames are accessed via controlled interfaces
- Pin count ensures:
  - No eviction during usage

---

## Pinning Concept

```text
pin_count > 0 → page in use → cannot evict
pin_count = 0 → eligible
```

---

# 13. Scalability Considerations

## Fixed Size Design

- Buffer pool size is static
- Trade-off:
  - Predictable memory usage
  - Limited flexibility

---

## Partitioning Advantage

```text
Reserved Zone → stability
General Zone  → flexibility
```

---

# 14. Architectural Summary

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

---

# 16. Relation to RookDB Architecture

The Buffer Manager:

- Sits below the Query Layer / Execution Engine Layer
- Manages in-memory caching
- Reduces disk access overhead


---
