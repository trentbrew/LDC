# LD-C Local-First App Progress

> Tracking progress on getting LD-C working for `*.data` files in a local-first context.

## Goal

Build a minimal local-first app that:

1. Reads `*.data` files (JSON-LD + LD-C extensions)
2. Evaluates `@expr`, `@view`, `@constraint`, `@query`
3. Returns computed values with provenance
4. Works entirely offline (no server required for basic eval)

---

## Status

| Component           | Status     | Notes                                                     |
| ------------------- | ---------- | --------------------------------------------------------- |
| Runtime evaluator   | ✅ Working | `core/runtime/src/core/evaluator.ts`                      |
| Expression parser   | ✅ Working | Supports arithmetic, member access, lambdas, `!` operator |
| DAG builder         | ✅ Working | Topological sort with fixpoint support                    |
| Query engine        | ✅ Working | SPARQL-ish patterns over quads                            |
| `.data` file loader | ✅ Working | `eval-data.ts` script                                     |
| CLI tool            | ✅ Working | `bun eval-data.ts <file.data>`                            |
| Watch mode          | ✅ Working | `bun eval-data.ts <file.data> --watch`                    |

---

## `.data` File Format

A `.data` file is valid JSON-LD with LD-C extensions:

```jsonc
{
  "@context": { ... },
  "@id": "file:///path/to/file.data",

  // Static data
  "items": [...],

  // Computed properties
  "total": { "@expr": "items.map(i => i.amount).reduce((a,b) => a + b, 0)" },

  // Materialized views
  "summary": {
    "@view": {
      "@expr": "{ count: items.length, total: total }"
    }
  },

  // Validation rules
  "valid": {
    "@constraint": "total >= 0"
  }
}
```

### Supported LD-C Keywords

| Keyword       | Purpose           | Example                                    |
| ------------- | ----------------- | ------------------------------------------ |
| `@expr`       | Computed property | `"sum": { "@expr": "a + b" }`              |
| `@view`       | Materialized view | `"v": { "@view": { "@expr": "..." } }`     |
| `@constraint` | Validation rule   | `"c": { "@constraint": "x > 0" }`          |
| `@query`      | Graph query       | `"q": { "@query": { "patterns": [...] } }` |

---

## Session Log

### 2025-11-27

**Started**: Local-first `.data` file support

**Discovered**:

- Runtime evaluator exists at `core/runtime/src/core/evaluator.ts`
- Supports `@expr`, `@view`, `@constraint`, `@query`
- Uses DAG for dependency ordering with fixpoint iteration
- Expression parser handles arithmetic, member access, lambdas, function calls

**Completed**:

1. ✅ Created `eval-data.ts` CLI script
2. ✅ Fixed evaluator to store computed values under plain keys (for dependency resolution)
3. ✅ Added `!` operator support to expression parser
4. ✅ Created example `.data` files:
   - `examples/simple.data` - Basic arithmetic
   - `examples/budget.data` - Financial calculations with constraints
   - `examples/tasks.data` - Sprint tracking with array operations
   - `examples/inventory.data` - Inventory with low-stock alerts

### Session 2

**Added Expression Features**:

1. ✅ Ternary operator: `condition ? then : else`
2. ✅ `&&` and `||` as aliases for `and`/`or`
3. ✅ String concatenation: `'Hello, ' + name`
4. ✅ Nested ternary: `a ? (b ? 'x' : 'y') : 'z'`

**Bugs Fixed**:

- Computed properties weren't finding each other due to IRI expansion mismatch
- Expression parser didn't support `!` (negation) operator
- DAG dependency matching failed (reads used plain keys, writes used IRIs)
- String concatenation failed when mixed with Decimal operations
- `collectReads` didn't walk ternary expressions for dependency tracking

**New Examples**:

- `examples/features.data` - Demonstrates ternary, `&&`, `||`, string concat
- Updated `examples/budget.data` - Added `status` and `statusMessage` using new features

**Known Limitations**:

- Expression parser doesn't support object literals `{ key: value }`
- Expression parser doesn't support array literals `[1, 2, 3]`
- `lowStockItems` (array result) doesn't serialize to quads (only primitives do)

**Next**:

- Add object/array literal support to expression parser
- Improve serialization for complex values
- Add `@rule` support for reactive updates
- Date/time functions

---

## Architecture

```
*.data file (JSON-LD + LD-C)
        │
        ▼
┌─────────────────┐
│   File Loader   │  Parse JSON, validate structure
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Evaluator     │  Build DAG, topo-sort, eval expressions
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Result        │  { value, diagnostics, prov }
└─────────────────┘
```

---

## Files

| Path                                   | Purpose           |
| -------------------------------------- | ----------------- |
| `core/runtime/src/core/evaluator.ts`   | Core evaluator    |
| `core/runtime/src/core/expr/parser.ts` | Expression parser |
| `core/runtime/src/core/dag/index.ts`   | DAG builder       |
| `core/runtime/src/core/query/index.ts` | Query engine      |
| `cli/`                                 | CLI tool (TODO)   |
