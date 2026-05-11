# Page Layout

Each data page is divided into the following sections:

- Page Header
- Item ID Array (Slot Directory)
- Free Space
- Tuple Data

The page uses a slotted-page layout inspired by PostgreSQL, where:
- the Item ID array grows forward from the beginning of the page,
- tuple data grows backward from the end of the page,
- and free space exists between them.

| Component | Description |
|---|---|
| **Page Header** | Stores the `lower` and `upper` offsets used for page space management. |
| **lower** | Points to the end of the Item ID array (slot directory). |
| **upper** | Points to the beginning of tuple data. |
| **Item ID Array (Slot Directory)** | Grows forward from the page header and stores metadata about tuples. |
| **Slot Entry Size** | Each slot entry is **8 bytes**. |
| **Slot Structure** | `offset` → 4 bytes, `length` → 4 bytes |
| **Slot Storage** | Slots are stored sequentially immediately after the page header. |
| **Tuple Count Calculation** | `(lower - PAGE_HEADER_SIZE) / ITEM_ID_SIZE` |
| **Tuple Data** | Actual tuple/record bytes stored from the end of the page backward. |
| **Free Space** | Space available between the Item ID array and tuple data. |
| **Free Space Calculation** | `upper - lower` |
| **Implementation Location** | `src/backend/page/mod.rs` |

![Logical Layout of a Page](/assets/Page-Architecture.png)

> **Note:** The current page layout is inspired by PostgreSQL. For reference, the PostgreSQL page layout is described at:  
> https://www.postgresql.org/docs/current/storage-page-layout.html#STORAGE-PAGE-LAYOUT-FIGURE