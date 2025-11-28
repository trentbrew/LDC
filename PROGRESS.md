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

### Session 3

**Added Rollups (Notion-style)**:

1. ✅ `@relations` - Load foreign `.data` files with aliases
2. ✅ `@rollup` shorthand - `"relation.property.select:aggregate"`
3. ✅ `@rollup` object form - With `filter` support
4. ✅ Aggregations: `sum`, `avg`, `count`, `min`, `max`, `first`, `last`, `concat`, `unique`, `all`

**Syntax Examples**:

```jsonc
// Shorthand
"totalBudget": { "@rollup": "projects.items.budget:sum" }
"projectCount": { "@rollup": "projects.items:count" }

// With filter
"activeBudget": {
  "@rollup": {
    "relation": "projects",
    "property": "items",
    "filter": "status == 'active'",
    "select": "budget",
    "aggregate": "sum"
  }
}
```

**New Examples**:

- `examples/projects.data` - Project data source
- `examples/team.data` - Team member data source
- `examples/dashboard.data` - Dashboard with rollups from both sources

**Added `@ref` for Simple Lookups**:

1. ✅ `@ref` - Direct property access from relations
2. ✅ Dot notation: `"config.theme.colors.primary"`
3. ✅ Array index: `"projects.items[0].name"`
4. ✅ Nested objects: `"config.limits.maxProjects"`

**Syntax Examples**:

```jsonc
// Simple property
"appName": { "@ref": "config.appName" }

// Nested path
"primaryColor": { "@ref": "config.theme.colors.primary" }

// Array index
"firstProject": { "@ref": "projects.items[0].name" }
```

**New Examples**:

- `examples/config.data` - Nested config data source
- `examples/ref-tests.data` - Comprehensive @ref tests
- `examples/rollup-tests.data` - Comprehensive @rollup tests

**Known Limitations**:

- Expression parser doesn't support object literals `{ key: value }`
- Expression parser doesn't support array literals `[1, 2, 3]`
- `lowStockItems` (array result) doesn't serialize to quads (only primitives do)
- Rollup filters only support simple comparisons (no `and`/`or`)

---

## Session 4: Built-in Functions

**Added 50+ Built-in Functions**:

| Category    | Functions                                                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Math**    | `$sqrt`, `$abs`, `$round`, `$floor`, `$ceil`, `$pow`, `$log`, `$log10`, `$sin`, `$cos`, `$tan`, `$pi`, `$e`, `$random`                         |
| **String**  | `$lower`, `$upper`, `$trim`, `$len`, `$substr`, `$replace`, `$split`, `$join`, `$startsWith`, `$endsWith`, `$contains`, `$padStart`, `$padEnd` |
| **Date**    | `$now`, `$today`, `$year`, `$month`, `$day`, `$hour`, `$minute`, `$dayOfWeek`, `$timestamp`, `$formatDate`, `$daysBetween`                     |
| **Utility** | `$if`, `$default`, `$coalesce`, `$type`, `$isNull`, `$isNumber`, `$isString`, `$isBool`, `$isArray`, `$toNumber`, `$toString`, `$toBool`       |
| **Array**   | `$first`, `$last`, `$at`, `$slice`, `$reverse`, `$sort`, `$unique`, `$flatten`, `$count`, `$sum`, `$avg`, `$min`, `$max`                       |

**Usage Examples**:

```jsonc
// Math
"squareRoot": { "@expr": "$sqrt(16)" },
"rounded": { "@expr": "$round(3.14159, 2)" },

// String
"formatted": { "@expr": "$upper($trim(name))" },
"initials": { "@expr": "$substr(firstName, 0, 1) + $substr(lastName, 0, 1)" },

// Date
"today": { "@expr": "$today()" },
"daysUntilDue": { "@expr": "$daysBetween($today(), dueDate)" },
"year": { "@expr": "$year(createdAt)" },

// Utility
"displayName": { "@expr": "$default(nickname, name)" },
"status": { "@expr": "$if(active, 'Active', 'Inactive')" },
"dataType": { "@expr": "$type(value)" },

// Array
"firstItem": { "@expr": "$first(items)" },
"total": { "@expr": "$sum(amounts)" },
"average": { "@expr": "$avg(scores)" }
```

**Bug Fixes**:

- Fixed `or` operator parsing (was checking 3 chars, but `or` is 2)
- Fixed string serialization for leading zeros (e.g., `"00042"`)

**New Examples**:

- `examples/builtins-test.data` - Comprehensive built-in function tests
- `examples/stress-test.data` - All features combined
- `examples/edge-cases.data` - Edge case handling

---

## Session 5: Literals, Compound Filters & Watch Mode

**Array Literals**:

```jsonc
"myArray": { "@expr": "[1, 2, 3]" },
"withVars": { "@expr": "[a, b, c]" },
"nested": { "@expr": "[[1, 2], [3, 4]]" },
"access": { "@expr": "[10, 20, 30][1]" }  // → 20
```

**Object Literals**:

```jsonc
"myObj": { "@expr": "{ x: 1, y: 2 }" },
"computed": { "@expr": "{ sum: a + b, product: a * b }" },
"access": { "@expr": "{ name: 'Bob' }.name" }  // → "Bob"
```

**Compound Rollup Filters**:

```jsonc
// AND with && or 'and'
"activeHighBudget": {
  "@rollup": {
    "relation": "projects",
    "property": "items",
    "filter": "status == 'active' && budget > 5000",
    "aggregate": "count"
  }
}

// OR with || or 'or'
"devOrDesigner": {
  "@rollup": {
    "relation": "team",
    "property": "members",
    "filter": "role == 'developer' || role == 'designer'",
    "select": "name",
    "aggregate": "concat"
  }
}
```

**Watch Mode for Related Files**:

```bash
bun eval-data.ts dashboard.data --watch
# 👀 Watching dashboard.data for changes...
# 👀 Also watching ./projects.data (projects)
# 👀 Also watching ./team.data (team)
```

**New Examples**:

- `examples/literals-test.data` - Array/object literals and compound filters

**All 15 example files pass**.

**Remaining Gaps**:

- Array/object results don't serialize to RDF quads (by design)
- No circular reference detection

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
