# Frontend CLI Steps

This page documents all new and updated interactive options in the RookDB CLI.

---

## Updated Menu

When you launch RookDB, the main menu now shows 12 options:

```
=============================
Choose an option:
1.  Show Databases
2.  Create Database
3.  Select Database
4.  Show Tables
5.  Create Table
6.  Load CSV
7.  Show Tuples
8.  Show Table Statistics
9.  Delete Tuples          ← NEW
10. Update Tuples          ← NEW
11. Compact Table          ← NEW
12. Exit
=============================
Enter your choice:
```

Options 1–8 are unchanged from the previous phase (note: **Show Tuples** now silently skips soft-deleted slots, but the CLI steps for it are unchanged). Options 9–11 are new.

---

## Delete Tuples (Option 9)

Soft-deletes rows matching an optional WHERE clause. Deleted rows are flagged in the slot array and invisible to scans immediately.

**Steps:**

1. Select option `9`
2. Enter the table name

```
Enter table name: students
```

3. Read the operator reference printed on screen, then type a WHERE clause (or leave it blank to delete **all** rows).

```
Supported operators : =  !=  <  <=  >  >=
Logical connectors  : AND  OR
Grouping            : use parentheses ( )
Leave empty         : delete ALL rows

WHERE clause: id <= 20000
```

4. The clause is parsed into DNF groups and echoed back for verification:

```
Parsed into 1 AND-group(s) connected by OR:
  Group 1: id Le Int(20000)
```

5. If you left the WHERE clause blank, a safety confirmation is required:

```
No WHERE clause – this will delete ALL rows in 'students'.
Are you sure? (yes/no):
```

6. Choose whether to print the deleted rows:

```
Print deleted rows? (y/n): y
```

7. Result summary is printed:

```
Deleted 20000 row(s).

=== Deleted rows ===
  id=1  |  name=Alice  |  age=20
  id=2  |  name=Bob    |  age=22
  ...
===================
```

**Supported WHERE operators:**

| Operator | Example |
|---|---|
| `=` | `dept = Engineering` |
| `!=` | `status != inactive` |
| `<` `<=` `>` `>=` | `salary > 50000` |
| `AND` | `dept = HR AND salary < 60000` |
| `OR` | `dept = HR OR dept = Sales` |
| `( )` grouping | `(dept = HR AND salary < 60000) OR dept = Sales` |
| `LIKE` | `name LIKE 'Ali%'` |
| `IN` | `id IN (1, 2, 3)` |

---

## Update Tuples (Option 10)

Updates rows matching an optional WHERE clause. Internally implemented as **soft-delete old version + insert new version**.

**Steps:**

1. Select option `10`
2. Enter the table name

```
Enter table name: students
```

3. Read the SET examples printed on screen, then type the SET clause:

```
SET clause examples:
  age = 25
  age = age + 1
  salary = salary * 1.10 , dept = Engineering

SET: score = score + 10
```

Multiple assignments are comma-separated.

4. Enter an optional WHERE clause (leave blank to update all rows):

```
WHERE clause (leave empty to update ALL rows):
WHERE: id <= 50000
```

5. If blank, a safety confirmation is shown:

```
No WHERE clause – this will update ALL rows in 'students'.
Are you sure? (yes/no):
```

6. Choose whether to print the updated rows:

```
Print updated rows? (y/n): n
```

7. Result summary:

```
Updated 50000 row(s).
```

**Supported SET expressions:**

| SET input | Meaning |
|---|---|
| `age = 25` | Set `age` to the literal `25` |
| `age = age + 1` | Increment `age` by 1 |
| `age = age - 5` | Decrement `age` by 5 |
| `salary = salary * 1.10` | Multiply `salary` by 1.10 |
| `salary = salary / 2` | Divide `salary` by 2 |
| `dept = Engineering` | Set `dept` to the literal text `"Engineering"` |

Comma-separate multiple assignments: `score = score + 10 , name = Unknown`

---

## Compact Table (Option 11)

Physically rewrites all pages, permanently removing soft-deleted tuples and reclaiming the freed space. After compaction the Visibility Map is updated and the FSM is rebuilt so new inserts can reuse the recovered space.

**Steps:**

1. Select option `11`
2. Enter the table name

```
Enter table name: students
```

3. Compaction runs immediately. If the table file cannot be found, an error is shown and nothing is changed.

4. Result summary:

```
Compaction complete. 18 page(s) had dead tuples removed.
```

**When to run:**

Compaction is also triggered **automatically** by the background autovacuum workers when:

```
dead_tuple_count  >  50 + 0.2 × total_page_count
```

You only need option 11 if you want to force an immediate compaction without waiting for the autovacuum threshold.

---

## Background Autovacuum (Automatic)

When RookDB starts, three background threads are launched automatically before the menu appears. These workers:

1. Sleep until a table exceeds its compaction threshold.
2. Dequeue the highest-priority table from the global max-heap.
3. Run `compaction_table` on it.
4. Update the Visibility Map and rebuild the FSM.
5. Go back to sleep.

No user action is required. The workers shut down cleanly when the user selects **Exit** (option 12).
