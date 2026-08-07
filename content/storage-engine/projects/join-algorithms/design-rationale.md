---
title: Design Rationale
sidebar_position: 1
---

# Design rationale

Why each significant decision was taken. Code comments say *what* something
does; this says *why*, and what the alternative would have cost.

The subsystem was rewritten rather than repaired. The previous version decoded
rows assuming `Column { data_type: String }` with fixed 4-byte INT and 10-byte
space-padded TEXT and no NULLs - a storage layer the engine no longer has. It
also carried a set of defects that were not bugs in an implementation so much
as consequences of its shape, and most of the decisions below exist to make
those defects *unrepresentable* rather than merely fixed.

---

## Three constraints that were not chosen

Everything else is downstream of these.

**Rows cannot be byte-concatenated.** `PhysicalSchema::from_logical` regroups
all fixed-length columns before all variable-length ones, across the whole
schema, and `RowLayout::compute` aligns them. `left_bytes ++ right_bytes` is
not a valid row. Every output row is therefore decode → concatenate values →
re-encode. This is not an optimisation we declined to make; it is forced.

**`deserialize_nullable_row` needs an exactly-sized slice.** The last
variable-length payload's length is derived from `row_bytes.len()`, so a row
read out of an over-long buffer silently mis-decodes its final column. This is
why every spill file is length-framed, and why nothing may hand the decoder a
padded buffer.

**There is no `DataValue::Null`.** NULL is `Option<DataValue>::None` plus a
per-row bitmap. The previous implementation's worst defect - NULL keys encoded
as `0` or ten spaces when spilling, so the same query returned different
answers depending on which algorithm ran - came from materialising a NULL as a
sentinel value. The design had to make that impossible, not merely avoided.

---

## The join key

### One order-preserving byte encoding

`JoinKey(Box<[u8]>)` derives `Hash`, `Eq`, `PartialOrd` and `Ord` from the same
byte slice.

The alternative was what the previous implementation had: three unrelated hash
functions, three unrelated serialisers, and a comparator that returned
`Ordering::Equal` whenever two values were incomparable. That last one is worse
than it sounds - it violates the total-order contract `BinaryHeap` and
`sort_by` rely on, so the merge phase of the sort-merge join was reading runs
that were not actually sorted.

Deriving all three traits from one encoding makes "hash agrees with equality"
and "the ordering is total" true by construction rather than by review.

### The encoding follows `Comparable`, not `PartialEq`

The engine's own two APIs disagree, and the key had to pick one:

| Case | `DataValue`'s derived `PartialEq` | `Comparable::compare` |
|---|---|---|
| `Real(+0.0)` vs `Real(-0.0)` | different (bit patterns) | equal |
| `Char("ab")` vs `Char("ab  ")` | different | equal (trailing whitespace stripped) |
| `Numeric(1.00)` vs `Numeric(1.0)` | different | equal (scales normalised) |

`compare` gives the SQL answer, so the encoder normalises `-0.0` to `+0.0`,
canonicalises every NaN, trims CHAR with `trim_end` (all trailing Unicode
whitespace, not only spaces - matching `str::trim_end`), and normalises NUMERIC
scale. `to_bytes()` does none of that, so hashing it directly would have made
values the engine calls equal fail to join.

### NULL is unrepresentable, not handled

`KeySpec::left_key` returns `Result<Option<JoinKey>, _>`; `Ok(None)` means some
component was NULL. There is no byte sequence a NULL encodes to, so two NULLs
cannot collide however many times a row is spilled and re-read. The `Option`
also forces every operator to decide, at compile time, what a NULL-keyed row
does - skip the hash table, route to the unmatched stream, sit outside the
merge.

### Type mismatch is a plan-time error

Only one coercion is automatic: integer widening, which mirrors `Comparable`'s
own SMALLINT ↔ INT ↔ BIGINT promotion and is lossless.

Everything else - INT vs REAL, CHAR vs VARCHAR, NUMERIC of differing scale - is
refused before a row is read. An implicit cast would route through a string
literal: `cast(Real(0.1), Int)` silently truncates, and `cast(Varchar("abc"),
Int)` fails per row, turning a schema error into either a wrong answer or a
failure ten thousand rows in. Implicit lossy casts convert "your query is
wrong" into "your answer is wrong". The escape hatch is explicit and shows up
in EXPLAIN.

Cross-scale NUMERIC is refused for a second reason: `Comparable::compare`
rescales with `10_i128.pow(...)` and an unchecked multiply, which panics in
debug builds for scale gaps beyond 38.

---

## Predicates

### The representation is the engine's own

`executor::selection`'s `Predicate`, `Expr`, `ComparisonOp` and `TriValue` are
reused unchanged, as is `apply_and` / `apply_or`. Two upstream helpers,
`compute_arithmetic` and `constant_to_data_value`, were made public rather than
copied, so arithmetic and literal handling inside a join condition cannot drift
from the same operations anywhere else in the engine.

What is *not* reused is `SelectionExecutor` for the join condition itself. It
evaluates one row against one table, so using it would mean materialising a
concatenated row for every candidate pair - O(|L| × |R|) serialisations even
under a hash join, which is exactly what the decode/re-encode constraint makes
expensive. It also resolves bare column names against a single schema, which is
how the previous implementation's self-joins ended up comparing a column to
itself.

`SelectionExecutor` *is* used where it fits: single-relation filters pushed into
a scan, evaluated against raw bytes.

### Splitting conditions is what makes multi-predicate joins correct

The previous implementation took its join key from `conditions[0]`. So:

- `A.x < B.y AND A.k = B.k` keyed on `x`/`y` and silently returned almost
  nothing;
- a pure non-equi join fed to hash or sort-merge returned roughly nothing, and
  the planner *routed* non-equi joins to sort-merge;
- an equality written `right = left` made sort-merge return zero rows, because
  it never checked which relation a column belonged to.

`split_conjuncts` flattens the `AND` tree, promotes *every* cross-relation
equality into the key with its orientation normalised once, and keeps
everything else as a residual that every key-based operator also applies. No
executor ever sees an unnormalised condition, and no executor has to guess
which conjunct is "the" join key. Zero equalities means hash, sort-merge and
index joins are simply *not applicable* rather than fed something arbitrary.

Equality under `NOT`, inside an `OR`, or over arithmetic is deliberately not
hoisted: those are not equijoins, and hoisting them would change the result.

### Resolution is qualifier-aware

An unqualified column present on both sides is an `AmbiguousColumn` error, not
a silent pick. Two relations sharing an alias is refused outright, so a
self-join must alias its sides apart. This is the direct fix for the old hash
join, which resolved both build and probe keys to the same column whenever
`build_table == probe_table` and silently missed every match.

### Pushdown legality is part of the split

A conjunct touching only the row-preserving side of an outer join cannot be
pushed into that side's scan - it would drop rows the join must emit
NULL-extended. `split_conjuncts` therefore takes the join type: under LEFT
OUTER a left-only conjunct is emitted into the *residual*, already rewritten
into the concatenated index space, because the residual and a local filter use
different index spaces and a later pass could not have moved it.

---

## Capability, enforced by types

The compatibility matrix is one `const ALGORITHMS` array. Every executor's
constructor requires a `ValidatedJoinSpec`, whose fields are private and which
only `AlgorithmSpec::validate` produces. A hash join for CROSS, or an index
join without an index, is unconstructable.

The previous implementation accepted SEMI, ANTI and NATURAL into its hash,
symmetric-hash, sort-merge and direct executors and silently computed an INNER
join. Here that cannot recur twice over: the token cannot be obtained, and SEMI
and ANTI produce a left-only output schema, so an executor emitting a
concatenated row would fail on the first row.

A CROSS join carrying a condition is refused rather than having it dropped or
applied - it is a mis-stated INNER join, and guessing which was meant is worse
than asking.

---

## Execution

### Operators are `Iterator`s, and `close` is `Drop`

`RowStream` is `Iterator<Item = Result<Vec<u8>, JoinError>>` plus a schema.
`open` is `PhysicalPlan::execute`; there is no `close`.

An explicit `close()` is strictly worse in Rust: it is skippable, and an early
`?` in the consumer, a `LIMIT`, or a panic would leak. `Drop` runs during
unwind, so a panic mid-join removes the spill directory. This is what makes the
old `cleanup()` - which deleted *every* file in the shared temp directory,
including other operators' - impossible to reintroduce.

### Rows travel as bytes

Spilling requires re-serialisation regardless, so bytes make a spill a memcpy.
`Vec<Option<DataValue>>` with heap `String`s is several times the footprint of a
packed row, which would make the memory accounting fiction. Decoding happens
once per row, never per comparison.

`RowCodec` exists because `deserialize_nullable_row` rebuilds `PhysicalSchema`
and `RowLayout` on *every* call - five allocations per row, on the hot path of
every operator. It precomputes them per schema and adds single-column
extraction, which upstream keeps private. The cost of not calling upstream
directly is drift, so `tests/test_join_row_codec.rs` asserts byte-identity with
`serialize_nullable_typed_row` and value-identity with
`deserialize_nullable_row` over randomly generated schemas.

### One definition of "these rows join"

`MatchEvaluator` is shared by every operator, so a nested loop, a hash join and
a sort-merge cannot disagree about what a match is. That shared definition is
what makes the cross-algorithm differential test meaningful.

---

## Memory and spilling

### The budget is a budget, not a limit

Rust exposes no allocator introspection, so `MemoryAccountant` is a deliberate
over-estimate of what an operator holds - row bytes plus a per-row constant,
plus a per-entry constant for hash tables. Its job is to trigger a strategy
change well before the real allocator is stressed. Treating it as a hard limit
would be wrong; treating it as a signal is exactly right.

Accountants form a tree so a resident partition is charged against the
operator's budget. There is deliberately no global accountant: a global would
couple every operator, and every test, to every other.

The floor is 4 KiB, not something larger. It only has to exceed one row plus
its hash entry - and keeping it small is what makes Grace and hybrid reachable
from a fast unit test. The previous implementation's Grace and hybrid paths ran
**zero** times under test, because its fixtures were two pages against a
ten-page budget.

### Spill files are framed and scoped

Length-framed records, not heap files. A heap file would add an 8 KiB header
page and a free-space-map fork *per partition* - 128 files before a single row
for a 64-way Grace join - and charge an FSM search, a page read, a page write
and a header rewrite per row, to buy random access and space reuse a spill file
never needs. Exact length framing is also the only framing that satisfies the
exact-slice constraint.

Each operator gets `{root}/join-{pid}-{epoch}-{counter}/`, with a process-global
counter, so the two sides of a self-join cannot collide - the old fixed names
(`sort_run_{table}_{n}.tmp`) meant the second `sort_relation` call truncated the
first's files. `SpillScope::drop` removes only its own directory and never
enumerates the root. A `RunHandle` holds an `Arc` to the scope, so a directory
outlives any reader still in flight.

Run files carry a magic number and the schema fingerprint. Reading a run under a
different schema is a hard error - which is precisely the failure the old
colliding run files hid.

`Drop` covers normal exits and panics. `sweep_orphans` covers SIGKILL: it
removes only directories whose names it recognises, whose owning process is
gone, and which are older than a threshold.

---

## Algorithms

### Hash is one operator, not three

In-memory, hybrid and Grace are runtime consequences of what fits, not separate
algorithms for the planner to choose between. On the first over-budget insert
the rows *already built* are repartitioned in place and partition 0 stays
resident - the build input is never re-read, which is what makes the transition
single-pass. Probe rows for the resident partition are joined as they arrive
rather than written out and read back; that is the whole point of the hybrid
form.

A partition that still does not fit is repartitioned with the recursion depth
mixed into the hash, so rows actually redistribute - hashing the same way again
would put every row straight back into one partition.

Past depth 3 the partition is loaded anyway and counted in
`oversized_partitions`. A partition that will not shrink is one where a single
key dominates it, and no amount of hashing separates rows that share a key.
Saying so is more useful than pretending otherwise.

### Sort-merge bounds its duplicate group

Every left row of a key group must see every right row of it, so the right
group is buffered and replayed. The previous implementation held it in a plain
`Vec`, so one hot key larger than memory took the process down. Here it is a
buffer that moves to disk when the budget is spent. Only one side is ever
buffered - left rows stream through the group one at a time.

NULL-keyed rows never enter the merge. They cannot match, so ordering them
against real keys would be meaningless; the sort sets them aside and they are
emitted as unmatched if the join type wants them.

### Symmetric hash says when it cannot continue

It has no build phase to partition, so it cannot spill. When the budget runs
out it returns `JoinError::OutOfMemory` with a suggestion, rather than growing
without bound. The planner does not offer it when the inputs will not fit, so
the cost model never has to describe a case that cannot happen.

### Adaptive measures rather than predicts

Both inputs are read in alternation; whichever ends first is *provably* the
smaller and becomes the build side. This holds with no ANALYZE, no statistics
and wrong estimates, because it is a measurement.

Reversal changes nothing observable. Rather than swapping rows and re-encoding
them, the hash join knows which relation it is probing and fills each half of
an output row from whichever input the *declared* schema says belongs there.
Key extraction and residual evaluation are side-aware for the same reason -
probing a reversed join with the left key, or evaluating a residual with its
arguments swapped, would be a silent wrong answer.

SEMI and ANTI are never reversed: they are defined in terms of left rows.

---

## Statistics

**Cardinality comes from the heap header.** `HeaderMetadata::total_tuples` is
maintained on insert and delete, so it is exact and free. The engine's
`collect_table_statistics` counts slot entries without skipping dead ones, so
it over-reports after a DELETE until compaction; it is used only for tuple
widths, and only behind the cache. `test_join_statistics.rs` records that
discrepancy as a characterisation test, so a future upstream fix is noticed.

**Column values are measured in join key encoding.** A distinct-value count is
only useful for join selectivity if it counts the equivalence classes the join
matches on. Encoding first means two CHARs differing in trailing spaces count
once - exactly as the join treats them - so estimates and execution cannot
drift apart. This is worth more than the choice of sketch.

**HyperLogLog rather than an exact set.** 4 KiB per column regardless of
cardinality, and mergeable. The HLL++ small-range correction is not optional:
without it a fifty-row fixture estimates wildly, and a cost model that cannot be
checked on small fixtures cannot be checked at all.

**Sampling is seeded.** Histogram boundaries - and therefore every estimate and
every EXPLAIN - are reproducible between runs. That reproducibility is itself
tested.

**Stale statistics are ignored, not partially trusted.** A sidecar whose
validity stamp no longer matches the table drops the plan to `header-only`,
where cardinality is still exact and per-column values are admitted guesses.
There is no auto-analyze and no background refresh: planning from numbers that
no longer describe the data is worse than planning from admitted ignorance.

The stamp is read *after* opening the heap, because `HeapManager::open`
synchronises the header and may rewrite the file. Taking it beforehand made
freshly written statistics look stale the moment they were saved - a latent
flakiness bug that only surfaced once enough tests ran to cross mtime's
one-second granularity.

---

## Cost

**Arithmetic rules are enforced module-wide.** Cardinalities are `u64` with
saturating operations; anything that could overflow goes through `f64`, whose
casts saturate; costs are `f64`; `usize` is not used at all. The previous
implementation's `tuple_count as usize * bytes_per_tuple` panicked in debug
builds and wrapped in release ones.

**Semi selectivity is bounded by construction.** `min(ndv) / ndv_left` is at
most one, so `|L ⋉ R| ≤ |L|` is a property of the formula rather than a clamp
bolted on afterwards. The old formula scaled by both row counts and
over-estimated a ten-row semi join a hundredfold.

**Sort passes are pass counts.** Zero when the input fits - no run is written,
so there is nothing to merge - otherwise `1 + ceil(log_fanin(runs))`. The old
model set `io_passes: rows as u32`, which is a row count wearing a pass count's
name.

**Estimate confidence is a cost input.** Adaptive carries a 5% premium when
statistics are measured and a 15% discount when they are guesses: adaptivity
buys nothing if the prediction is already right, and is worth paying for when
it is not. This is the honest way to spend a self-correcting operator.

**Building costs more than probing.** Charging hash build and probe rows alike
makes the formula symmetric in its inputs, and the planner then cannot see why
building from the smaller side is worth anything. Benchmarking a 200-row
relation against a 20 000-row one surfaced this: the adaptive operator was
measurably a third faster and the model could not tell.

---

## Ordering and multi-relation execution

**A predicate is applied at the lowest node that can evaluate it.** Every
conjunct carries the set of relations it mentions, and waits until a node's
subtree covers that set. A three-relation conjunct therefore joins in when the
third relation does, rather than being forced onto a two-relation edge where a
third of it cannot be resolved.

**Conditions are rewritten onto synthetic positional names.** A node's inputs
are subtrees, not relations, so its columns are named `l0`, `r3` and the
conjuncts being applied are rewritten to match. That reuses the entire
two-relation apparatus - resolution, conjunct splitting, key extraction,
three-valued evaluation - instead of growing a second one. The *output* schema
keeps the real qualified names, so a column is still called `orders.id` however
many joins it passes through.

**Output column order does not depend on the plan.** The optimiser may join the
relations in any order, but a caller who asked for `a JOIN b` gets a's columns
first: the root is permuted back into the declared order if the chosen plan
produced another. This is the same rule the adaptive operator follows for
build-side reversal, for the same reason - the shape of an answer should not
reveal how it was computed.

**Only connected subsets are searched.** Enumerating disconnected ones means
costing plans that form a Cartesian product in the middle of a query that never
asked for one - which the previous implementation did, because it stored its
join conditions and never consulted them.

Cross products remain reachable where the query genuinely has no path: the
graph is split into components, each optimised alone, and they are combined
smallest-first *outside* the search, where the cost is explicit and the node is
labelled.

**Every node is costed across all applicable algorithms.** The old DP hardcoded
block nested loop for every node, which made its cost-based ordering a
cost-based ordering of one plan shape.

**Bushy plans are considered.** With spilling hash joins, building two small
intermediates can beat dragging one large intermediate through every step, and
this engine has no parallelism for a left-deep pipeline to exploit.

---

## Deliberate limitations

Recorded here rather than left to be discovered.

**Outer joins are reordering barriers.** Reordering across one changes the
answer, and doing it correctly needs conflict and eligibility sets that are easy
to get subtly wrong. Only inner-join blocks are reordered.

**Interesting orders are not tracked.** A memo entry keeps the cheapest plan for
a subset, not the cheapest per sort order, so a chain of sort-merge joins
re-sorts rather than reusing an existing order.

**Multi-relation execution materialises its right inputs.** The left spine of a
plan streams, so a left-deep join holds one intermediate at a time and that one
spills if it outgrows the budget. A bushy plan holds one per level. Nothing is
pipelined through a join node's right side, because the operators below need a
re-openable input.

**LATERAL is absent** because nothing in the engine evaluates a correlated
subquery. **NATURAL** is a resolution-time rewrite, with FULL OUTER's shared
column correctly `COALESCE(l.c, r.c)`.

**CHAR compared to a text literal is an error**, because `Constant::Text`
becomes VARCHAR and the two are not comparable. That limitation is the engine's,
shared with single-relation selection, and is recorded as a characterisation
test.

---

## Upstream defects found while building this

Worked around here; each deserves an upstream fix.

1. **`Comparable::compare` can panic on NUMERIC** - `10_i128.pow((a.scale −
   b.scale) as u32)` and `b.unscaled * factor` are unchecked. Worked around by
   refusing cross-scale NUMERIC keys at plan time.
2. **`serialize_nullable_typed_row` corrupts rows past 65535 bytes** - the
   var-len offset is cast with `as u16` and wraps; the result does not survive
   a round trip and currently panics on a reversed slice range. `RowCodec`
   refuses instead. Latent for the heap, since a row that large cannot fit an
   8 KiB page, but reachable through spill files.
3. **VARCHAR length is enforced on decode but not on encode**, so upstream can
   write a row it cannot read back. `RowCodec` refuses at encode time.
4. **`collect_table_statistics` over-counts after DELETE** - it does not skip
   dead slots.
5. **`DataValue`'s derived `PartialEq` disagrees with `Comparable::compare`** on
   signed zero. Any code mixing the two is latently wrong.
6. **`deserialize_nullable_row` rebuilds its layout per call** - five
   allocations per row.
7. **`HeapScanIterator` reopens the file on every page transition.**
8. **`load_catalog()` is infallible** - a corrupt catalog silently yields an
   empty one, so a real table would report "not found". The join subsystem
   never calls it.
9. **`HeapManager::create` deletes any existing file at its path.**
