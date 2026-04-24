---
title: Physical Storage Format
sidebar_position: 7
---

# Catalog Manager — Physical Storage Format

This page provides a byte-level breakdown of the binary `.dat` files used by the Catalog Manager. Since these files cannot be inspected as plain text, understanding the binary structure is essential for debugging and verification.

RookDB system catalogs use the **identical slotted-page storage format** as user tables, ensuring consistency across the storage engine.

---

## 1. File Structure Overview

Each catalog file (e.g., `pg_table.dat`) is composed of fixed-size **8,192-byte pages**.

| Page Index | Type | Purpose |
|------------|------|---------|
| `0` | Header Page | Stores global metadata (e.g., total page count). |
| `1+` | Data Page | Stores tuple data using a slotted layout. |

---

## 2. Header Page (Page 0) Layout

The first page of every catalog file acts as the table header.

| Byte Offset | Size | Name | Description |
|-------------|------|------|-------------|
| `0–3` | 4 | `page_count` | Total number of pages in the file (u32, Little-Endian). |
| `4–8191` | 8188 | Reserved | Unused space, zero-filled. |

---

## 3. Data Page (Slotted Page) Layout

Every data page (Page 1 onwards) follows the PostgreSQL-inspired slotted-page layout.

| Byte Offset | Size | Name | Description |
|-------------|------|------|-------------|
| `0–3` | 4 | `lower` | Pointer to the start of **free space** (u32 LE). Also the end of the Item ID array. |
| `4–7` | 4 | `upper` | Pointer to the end of **free space** (u32 LE). Also the start of the latest tuple data. |
| `8 to lower` | var | `Item IDs` | Array of 8-byte identifiers for every tuple on the page. |
| `lower to upper` | var | `Free Space` | Unallocated bytes. |
| `upper to 8191` | var | `Tuple Data` | The actual serialized catalog records, growing backwards. |

### Item Identifier (8 bytes)

Each entry in the `Item IDs` array describes one slot on the page.

| Byte Offset | Size | Name | Description |
|-------------|------|------|-------------|
| `0–3` | 4 | `offset` | Offset from the start of the page to the tuple data (u32 LE). |
| `4–7` | 4 | `length` | Byte length of the tuple (u32 LE). **0** indicates a logically deleted tuple. |

---

## 4. Tuple Serialization Format

Catalog records are serialized into variable-length byte slices.

### Basic Types

| Type | Bytes | Format |
|------|-------|--------|
| `u8` / `i8` | 1 | Direct byte |
| `u16` / `i16` | 2 | Little-Endian |
| `u32` / `i32` | 4 | Little-Endian |
| `u64` / `i64` | 8 | Little-Endian |
| `bool` | 1 | `0x01` for true, `0x00` for false |

### Variable-Length Types

| Type | Structure | Description |
|------|-----------|-------------|
| **String** | `[len: u16 LE] [bytes]` | A 2-byte length prefix followed by UTF-8 bytes. |
| **Array** | `[count: u16 LE] [items]` | A 2-byte count prefix followed by N serialized items. |

---

## 5. Worked Example: `pg_database` Record

Consider a record for the `system` database (`db_oid=1`, `owner="rookdb"`, `encoding=1`):

### Binary Breakdown (Serialised Tuple)

| Offset | Bytes | Meaning | Value |
|--------|-------|---------|-------|
| `0-3` | `01 00 00 00` | `db_oid` | `1` |
| `4-5` | `06 00` | `db_name` length | `6` |
| `6-11` | `73 79 73 74 65 6d` | `db_name` bytes | `"system"` |
| `12-13` | `06 00` | `owner` length | `6` |
| `14-19` | `72 6f 6f 6b 64 62` | `owner` bytes | `"rookdb"` |
| `20-27` | `XX XX XX XX XX XX XX XX` | `created_at` | Timestamp |
| `28` | `01` | `encoding` | `1` (UTF-8) |

### Page Insertion State

If this was the first record on Page 1:
1. **Header**: `lower` = 16 (Page Header (8) + 1 Item ID (8)), `upper` = 8163 (8192 - 29).
2. **Item ID 0**: `offset` = 8163, `length` = 29.
3. **Data**: Bytes 8163–8191 contain the tuple shown above.

---

## 6. Inspecting .dat Files

To manually inspect these files, you can use a hex editor or utility like `hexdump`:

```bash
# View the global header (Page 0)
hexdump -C -n 8 database/global/catalog_pages/pg_table.dat

# View the start of Page 1 (Data Page Header)
hexdump -C -s 8192 -n 16 database/global/catalog_pages/pg_table.dat
```
