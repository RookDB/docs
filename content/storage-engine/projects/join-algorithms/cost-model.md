---
title: Cost Model
sidebar_position: 3
---

# The cost model

Costs are in estimated milliseconds. Absolute values matter less than relative
ones - the planner only ever compares them.

## Arithmetic rules

Enforced throughout `cost.rs`, and worth preserving:

- cardinalities are `u64` and combine with saturating operations;
- anything that could overflow is computed in `f64` and converted back with
  `as u64`, whose float-to-integer casts saturate rather than wrap;
- costs are `f64`;
- **`usize` is not used at all** - it is 32 bits on some targets, and the
  previous implementation's `tuple_count as usize * bytes_per_tuple` panicked
  in debug builds and wrapped in release ones.

`test_join_cost_model.rs` feeds `u64::MAX / 2` rows to every algorithm and
requires a finite, non-NaN cost.

## Coefficients

| Coefficient | Default (ms) | What it prices |
|---|---|---|
| `seq_page` | 0.010 | one sequential page read |
| `random_page` | 0.040 | one random page read |
| `cpu_tuple` | 0.000_10 | emitting or building one row |
| `cpu_key` | 0.000_05 | extracting or comparing one key |
| `cpu_hash` | 0.000_04 | hashing one key |
| `cpu_compare` | 0.000_02 | one value comparison |

The ratios are PostgreSQL-shaped: random access is roughly four times a
sequential page, and CPU work is orders of magnitude below I/O.

## Cardinality

**Equijoin** - System-R containment. Each side's matchable rows spread over its
distinct values, paired through the *larger* of the two counts:

```
|L ⋈ R| = |L|·(1 − nullfrac_L) · |R|·(1 − nullfrac_R) / max(ndv_L, ndv_R)
```

Raising the smaller side's distinct count below that threshold correctly
changes nothing - that is the containment assumption, not a bug.

**Composite keys** multiply the per-column counts, capped at the row count: a
table cannot hold more distinct combinations than it has rows. Independence
between key columns is assumed.

**Semi** - `min(ndv_L, ndv_R) / ndv_L`, which is at most one, so `|L ⋉ R| ≤ |L|`
is a property of the formula rather than a clamp added afterwards. **Anti** is
`|L| − |L ⋉ R|`. **Outer** adds the unmatched rows of whichever sides are
preserved, derived from the same quantity so the family stays consistent.

**Range predicates** convolve the two columns' 64-bucket equi-depth histograms -
4096 bucket pairs, each contributing fully, not at all, or half. Without
histograms the default is 1/3; for a conjunct nothing is known about, 0.25.

## Per-algorithm cost

With `B` = memory in pages, `pages` and `rows` per side:

**Simple nested loop** - the inner relation is re-read per outer row:
`pages_L + rows_L · pages_R` I/O, `rows_L · rows_R` comparisons.

**Block nested loop** - one inner pass per block:
`pages_L + ceil(rows_L / block) · pages_R`.

**Index nested loop** - one descent and one fetch per outer row, plus the rows
each probe returns: `pages_L + rows_L · (1 + matches) · random_page`, with
`matches = rows_R / ndv_R`.

**Sort merge** - per side, `passes = 0` if it fits, else
`1 + ceil(log_{B−1}(pages / B))`; each pass reads and writes the relation.
Zero when it fits is the important part: no run is written, so there is nothing
to merge.

**Hash** - one pass over each input, plus two more over the spilled fraction
`1 − min(B / pages_build, 1)`. CPU charges the build side more than the probe
side:

```
cpu = rows_build · (cpu_hash + cpu_key + cpu_tuple)
    + rows_probe · (cpu_hash + cpu_key)
```

Charging them alike would make the formula symmetric in its inputs, and the
planner could then not see why building from the smaller side is worth
anything. See "Calibration" below - this came from a measurement.

**Symmetric hash** - one pass over each input, both resident, hashing both
sides. The planner does not offer it when the inputs will not fit, so there is
no spilling term to model.

**Adaptive** - costed as what it will actually run: a block nested loop with no
equality; otherwise a hash join *with the sides ordered so the smaller builds*,
since that is what it does. Then a 5% premium when statistics are measured and
a 15% discount when they are guesses - adaptivity buys nothing if the
prediction is already right, and is worth paying for when it is not.

## Calibration

```sh
cargo run --release --bin benchmark_joins
cargo run --release --bin benchmark_joins -- --rows 100000 --json
```

Four scenarios: a resident selective join, a resident join with heavy
duplicates, the same under a 1 MiB budget, and a small outer relation against a
large inner one. Each algorithm gets a discarded warm-up run and five measured
ones; median and p95 are reported, along with the algorithm the planner chose.

**The check that matters is whether the planner's choice matches the fastest
measured algorithm.** If it does not, the model has a structural gap, and
adjusting coefficients will paper over it rather than fix it.

That is how the build-versus-probe asymmetry above was found. On 200 × 20 000
rows the adaptive operator measured ~3.8ms against the hash join's ~6.4ms -
because it reverses and builds from the 200-row side - but the planner chose
the hash join. The formula summed `left_rows + right_rows`, so swapping the
sides changed nothing. Charging build rows more than probe rows made the model
agree with the measurement, in both directions: it still prefers the plain hash
join on symmetric inputs, where that is genuinely faster.

To adjust the coefficients, scale `seq_page` so a scan-dominated scenario's
predicted cost lands near its measured milliseconds, then scale the CPU
coefficients against a duplicate-heavy scenario, where output volume dominates.
Keep the ratios between the CPU coefficients unless you have a reason to move
them.

## What remains an estimate, and which way it is wrong

| Quantity | Source | Bias |
|---|---|---|
| Distinct values | HyperLogLog, p=12 | ±1.6% typical; only for analyzed columns. Unanalyzed falls back to `n^0.75`, which **understates** a unique column and makes index joins look worse than they are |
| Conjunct interaction | assumed independent | **Under**-estimates output for correlated predicates |
| Join key skew | histograms are marginal | No model of one key dominating; the hash join reports it at run time instead |
| Buffer cache | assumed always cold | **Over**-estimates I/O uniformly, so it does not distort the comparison between plans |
| CPU coefficients | machine-dependent | Calibrated per machine, or left at defaults |
| Intermediate results in a multi-relation plan | every row assumed to carry a distinct key | **Over**-estimates the output of joins above the first |

None of these is hidden from the user: EXPLAIN prints `stats=analyzed`,
`header-only` or `defaults`, so an estimate built on measurement and one built
on a guess do not look alike.
