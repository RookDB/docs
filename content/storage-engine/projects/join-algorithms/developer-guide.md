---
title: Developer Guide
sidebar_position: 2
---

# Developer guide

## Module map

```
src/backend/join/
  mod.rs              public surface; the `unwrap`/`expect`/`panic` denials
  error.rs            JoinError - every fallible path returns it
  schema.rs           RelationSchema, OutputSchema, the type fingerprint
  row.rs              RowCodec (layout precomputed per schema), RowBuilder
  key.rs              KeyClass, JoinKey, the order-preserving encoding
  predicate.rs        side-aware resolution, split_conjuncts, 3VL evaluation
  algorithm.rs        JoinType, the capability matrix, ValidatedJoinSpec
  config.rs           JoinConfig - work memory, spill root
  memory.rs           MemoryAccountant
  spill.rs            SpillScope (RAII), run files, spillable row buffers
  sort.rs             external sort: run generation, k-way merge
  cost.rs             cardinality estimation and the cost model
  stats/              HyperLogLog, histograms, ANALYZE, the stats cache
  index/              JoinIndex trait, SortedKeyIndex
  order.rs            join graph, connectivity, DP over connected subsets
  exec/multi.rs       running a chosen order
  plan.rs             JoinBuilder, PhysicalPlan, EXPLAIN
  source.rs           RowSource / RowStream, table scans, buffer adapters
  catalog_bridge.rs   the ONLY place the subsystem reads the catalog
  exec/               the seven operators
src/frontend/join_cmd.rs   the interactive menu
src/bin/benchmark_joins.rs timings and cost calibration
```

Dependencies run downward: `exec/` uses `key`, `row`, `spill`, `memory`;
`plan` uses `cost`, `stats`, `index`, `order`; nothing below `plan` knows what
a catalog is.

## Invariants worth not breaking

1. **`JoinKey`'s three traits come from one encoding.** If you add a key class,
   add it to `KeyClass::of`, `tag`, `encode_component`, and to the invariant
   test in `test_join_key_encoding.rs` that checks byte order against
   `Comparable::compare`.
2. **A NULL key is `Ok(None)`, never a sentinel.** Nothing may invent an
   encoding for it.
3. **Executors are constructed from `ValidatedJoinSpec`.** Do not add a
   constructor that skips it.
4. **Spill directories are removed by `Drop`.** Do not add a `close()`.
5. **Statistics are measured in key encoding.** Hashing a raw value would make
   the distinct count count the wrong thing.
6. **Nothing below `catalog_bridge` reads the catalog.** That is what keeps the
   tests hermetic.

## Adding an algorithm

1. Add a variant to `JoinAlgorithm` and an entry to `ALGORITHMS` in
   `algorithm.rs`, declaring the join types it supports, whether it needs
   equality keys or an inner index, and whether it can spill.
2. Write the operator in `exec/`. Take `&ValidatedJoinSpec` in the constructor;
   implement `Iterator<Item = Result<Vec<u8>, JoinError>>` and `RowStream`. Use
   `MatchEvaluator` for matching and `RowBuilder` for output rows - do not
   re-derive either.
3. Add a cost arm in `CostModel::cost`.
4. Add it to `AVAILABLE` in `plan.rs` and to the dispatch in `build_operator`.
5. Add it to `EQUI_ALGORITHMS` in `tests/test_join_algorithms.rs`.

Step 5 is the one that matters. That test runs every algorithm against the
reference join for six join types at two memory budgets, over fixtures with
duplicates on both sides, NULL keys on both sides, composite keys and empty
inputs. If it passes, the operator is very likely correct; if you skip it, no
other test will catch a wrong answer.

`test_join_types.rs` walks the whole `ALGORITHMS × JoinType` cross product and
requires each pair either to be refused or to match the reference, so a matrix
entry claiming support that is not implemented fails.

## Testing

```sh
cargo test                                    # everything
cargo test --test test_join_algorithms        # the cross-algorithm matrix
cargo test --test test_join_key_encoding      # the encoding against Comparable
cargo test --test test_join_spill             # framing, scoping, cleanup
cargo test --test test_join_cli_no_panic      # adversarial input
```

Randomised tests print their seed and honour `ROOKDB_JOIN_SEED`:

```sh
ROOKDB_JOIN_SEED=12345 cargo test --test test_join_key_encoding
```

### The reference join

`tests/join_common/mod.rs` has `reference_join` - a deliberately naive O(n·m)
loop. It shares the match evaluator with the real operators, because predicate
semantics have their own thorough tests and re-deriving them would only test
the test. What it does *not* share is the loop: no blocking, no partitioning,
no spilling, no sorting, no early exit. That is the part operators get wrong.

`assert_rows_eq` compares **multisets of decoded rows**, not lengths. A join
that emits a row twice is as wrong as one that drops it, and comparing counts -
which is all the previous test suite ever did - cannot see a wrong value, a
wrong column order, or a NULL in the wrong place.

### Forcing the spilling paths

Set a tiny budget. Everything is reachable from a unit test:

```rust
let config = JoinConfig::with_work_memory(8 * 1024).spill_root(db.path());
```

Then assert the path was *taken*, not merely that nothing crashed:

```rust
assert!(stats.partitions > 0);          // the hash join partitioned
assert!(stats.sort_runs > 0);           // the sort spilled runs
assert!(stats.spilled_groups > 0);      // a duplicate group spilled
assert!(stats.oversized_partitions > 0);// one key dominated a partition
assert!(stats.role_reversed);           // adaptive built from the left
```

### Hermetic tests

`TempDb` creates a scratch directory named by pid and an atomic counter, and
removes it on drop. Because the subsystem never reads the catalog and never
resolves paths through `layout::*`, tests share no state: no global mutex, and
therefore no mutex to poison when one of them fails.

Insert through `TableHandle::insert`, not `insert_single_tuple` - the latter
takes `&[&str]` and cannot express a NULL at all, which would make the entire
NULL test matrix impossible.

## Reading EXPLAIN

```
Hash Join (Inner)  [rows=2998  cost=1.24ms  stats=analyzed]
  Join Cond: emp.dept = dept.id
  Residual:  emp.salary < dept.budget
  Index:     8000 entries on dept
  Cost:      io=0.28ms  cpu=0.96ms  extra passes=0
  -> Scan on emp   [rows=300  pages=3]
       Filter: emp.salary > 100
  -> Scan on dept  [rows=300  pages=3]
  Considered: Sort Merge 1.51ms, Block Nested Loop 2.34ms
```

- **`stats=`** - `analyzed` (a current sidecar), `header-only` (exact rows and
  pages, inferred per-column values), or `defaults` (the table could not be
  read). Treat estimates under the last two accordingly.
- **`Join Cond`** - the equalities driving the key. Empty means no key-based
  algorithm was applicable.
- **`Residual`** - what the key could not express, re-checked per candidate.
- **`Filter`** - pushed into a scan. Absent under an outer join on the
  row-preserving side, where pushing is illegal.
- **`extra passes`** - merge passes or partitioning rounds beyond the first.
- **`Considered`** - the alternatives, cheapest first.

## Tuning

Nothing behavioural is compiled in. `JoinTuning` holds the thresholds and every
one has an environment override, so they can be changed without a rebuild:

| Variable | Default | Controls |
|---|---|---|
| `ROOKDB_JOIN_WORK_MEM` | a quarter of free RAM | bytes an operator may hold |
| `ROOKDB_JOIN_SPILL_ROOT` | `database/tmp/join` | where spill directories go |
| `ROOKDB_JOIN_FAN_OUT` | 16 | partitions per level in a hash join |
| `ROOKDB_JOIN_MAX_REPARTITION` | 3 | repartitioning attempts before giving up |
| `ROOKDB_JOIN_BLOCK_ROWS` | 1024 | outer rows a nested loop buffers |
| `ROOKDB_JOIN_SAMPLE_ROWS` | 8192 | rows read to find the smaller side |
| `ROOKDB_JOIN_PRESSURE_ROWS` | 65536 | rows between system-memory checks |
| `ROOKDB_JOIN_PRESSURE_FRACTION` | 0.10 | free-memory fraction that halves the budget |
| `ROOKDB_JOIN_MERGE_BUFFER` | 65536 | read-ahead assumed per run when merging |
| `ROOKDB_JOIN_MAX_DP_RELATIONS` | 8 | relations above which ordering goes greedy |
| `ROOKDB_JOIN_HISTOGRAM_BUCKETS` | 64 | buckets per column histogram |
| `ROOKDB_JOIN_HISTOGRAM_SAMPLE` | 20000 | values sampled for boundaries |
| `ROOKDB_JOIN_MAX_DISPLAY_ROWS` | 200 | rows the CLI prints |
| `ROOKDB_JOIN_FALLBACK_ROWS` / `_PAGES` / `_ROW_BYTES` | 1000 / 10 / 100 | assumed for an unreadable relation |

`JoinConfig::resolve()` reads them; `JoinConfig::with_work_memory()` does not,
so a config built by hand is not altered behind the caller's back - which is
what keeps tests independent of the ambient environment.

Values that are *not* tunable, because they are format or algorithm
definitions rather than policy: the spill and index file magic numbers, the
FNV constants, the HyperLogLog precision (it is baked into saved sketches), the
reservoir seed (determinism), and the capability matrix.

## Common tasks

**Improve estimates**: run ANALYZE (menu 15 → 3). Until then the planner has
exact cardinality but guesses distinct values at `n^0.75`, which understates a
unique column and makes index joins look worse than they are.

**Make a join use an index**: build one (menu 15 → 4) on the *inner* relation's
key column. It is discovered automatically while the table is unchanged; any
modification invalidates the stamp and the index is ignored until rebuilt.

**Investigate memory**: set `ROOKDB_JOIN_WORK_MEM` (bytes) or use menu 15 → 6.
Lowering it forces spilling and is the quickest way to reproduce a
partitioning problem.

**Recalibrate the cost model**: see [cost-model.md](cost-model.md).

## Where the spill files go

`database/tmp/join/join-{pid}-{epoch}-{counter}/`, removed when the operator
drops - including during a panic. If a process is killed outright, the next
join sweeps directories whose owning process is gone and which are older than
an hour. Nothing else in that tree is ever touched.
