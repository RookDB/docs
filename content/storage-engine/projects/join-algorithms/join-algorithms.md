---
title: Join Algorithms
sidebar_position: 2
---

# The RookDB join subsystem

Equi and non-equi joins over the engine's typed row format, with a cost-based
planner, spilling operators, and statistics that are measured rather than
guessed.

| Document | What it covers |
|---|---|
| [design-rationale.md](design-rationale.md) | Why each significant decision was taken, and what it prevents |
| [developer-guide.md](developer-guide.md) | Module map, how to add an algorithm, how to run and read the tests |
| [cost-model.md](cost-model.md) | The formulas, what remains an estimate, and how to recalibrate |

## What it does

Seven physical operators:

| Algorithm | Needs | Supports |
|---|---|---|
| Simple nested loop | nothing | every join type |
| Block nested loop | nothing | every join type |
| Index nested loop | an equality and an index on the inner side | INNER, LEFT, SEMI, ANTI |
| Sort merge | an equality | all but CROSS |
| Hash (in-memory / hybrid / Grace) | an equality | all but CROSS |
| Symmetric hash | an equality, and both inputs in memory | all but CROSS |
| Adaptive | nothing | every join type |

Join types: INNER, LEFT OUTER, RIGHT OUTER, FULL OUTER, CROSS, SEMI, ANTI.
NATURAL is a rewrite, not a join type. LATERAL is not supported, because
nothing in the engine can evaluate a correlated subquery.

## Using it

From the CLI, main menu option **15 - Join Operations**. Everything is chosen
from numbered prompts; there is no query language.

```
1. Run a join            two tables, any join type
2. Explain a join        the same, showing only the plan
3. Run a multi-table join  three or more tables, order chosen by cost
4. Analyze a table       measure distinct values, NULLs and histograms
5. Build a join index    a sorted index on one column
6. Drop a join index
7. Join settings         working memory, spill directory
```

From Rust:

```rust
use storage_manager::join::{JoinBuilder, JoinType, catalog_bridge};

let left  = catalog_bridge::resolve(&catalog, "shop", "orders",  "o")?;
let right = catalog_bridge::resolve(&catalog, "shop", "customers", "c")?;

let mut stream = JoinBuilder::new(left, right, JoinType::Inner)
    .with_condition(condition)
    .execute()?;

while let Some(row) = stream.next() {
    let row = row?;   // serialized, in the join's output schema
}
```

Multi-relation joins go through the optimiser:

```rust
use storage_manager::join::{JoinGraph, TableStatsCache, execute_ordered, optimize};

let graph = JoinGraph::build(relations, Some(&condition), &TableStatsCache::new())?;
let plan  = optimize(&graph, config.work_memory_bytes)?;
let mut stream = execute_ordered(&graph, &plan, &config)?;
```

## Two things worth knowing before reading the code

**A join key is a byte string.** `JoinKey` derives `Hash`, `Eq` and `Ord` from
one order-preserving encoding, so hash equality and merge ordering cannot
disagree. A NULL key has no encoding at all - `try_key` returns `Ok(None)` -
which is how "NULL never matches NULL" holds in every algorithm at once,
including after a row has been written to and read back from a spill file.

**Statistics are measured, or admitted to be absent.** Every plan carries a
confidence - `analyzed`, `header-only`, or `defaults` - and EXPLAIN prints it.
A stale statistics sidecar is ignored, never partially trusted.

## Running the tests

```sh
cargo test                                   # everything
cargo test --test test_join_algorithms       # all operators against the reference join
cargo test --test test_join_multi_way        # multi-relation execution
cargo test --test test_join_key_encoding     # the key encoding against Comparable
cargo run --release --bin benchmark_joins    # timings, and cost-model calibration
```
