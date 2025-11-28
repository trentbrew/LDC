# LD-C Gap Analysis & Improvement Opportunities

## Test Results Summary

### ✅ Working Features

| Category        | Feature                                                                 | Status |
| --------------- | ----------------------------------------------------------------------- | ------ | ------ | --- |
| **Arithmetic**  | `+`, `-`, `*`, `/`, `%`, `**`                                           | ✅     |
| **Comparison**  | `>`, `<`, `>=`, `<=`, `==`, `!=`                                        | ✅     |
| **Logical**     | `and`, `or`, `not`, `&&`, `                                             |        | `, `!` | ✅  |
| **Ternary**     | `cond ? then : else`                                                    | ✅     |
| **Strings**     | Concatenation with `+`                                                  | ✅     |
| **Refs**        | `@ref` with dot notation                                                | ✅     |
| **Refs**        | `@ref` with array index `[n]`                                           | ✅     |
| **Rollups**     | All aggregates (sum, avg, count, min, max, first, last, concat, unique) | ✅     |
| **Rollups**     | Filters with `==`, `!=`, `>`, `<`, `>=`, `<=`                           | ✅     |
| **Constraints** | `@constraint` pass/fail                                                 | ✅     |
| **Views**       | `@view` with `@expr`                                                    | ✅     |
| **Chaining**    | Refs/rollups in expressions                                             | ✅     |

### ⚠️ Edge Cases Handled

| Case                | Behavior                            |
| ------------------- | ----------------------------------- |
| Empty string        | Works correctly                     |
| Null values         | `null == null` is true              |
| Undefined refs      | Returns `undefined` (no error)      |
| Out-of-bounds array | Returns `undefined` (no error)      |
| Empty rollup filter | Returns 0 for sum/count             |
| Division by zero    | Throws error (caught as diagnostic) |

### ✅ Built-in Functions (IMPLEMENTED)

| Category    | Functions                                                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Math**    | `$sqrt`, `$abs`, `$round`, `$floor`, `$ceil`, `$pow`, `$log`, `$log10`, `$sin`, `$cos`, `$tan`, `$pi`, `$e`, `$random`                         |
| **String**  | `$lower`, `$upper`, `$trim`, `$len`, `$substr`, `$replace`, `$split`, `$join`, `$startsWith`, `$endsWith`, `$contains`, `$padStart`, `$padEnd` |
| **Date**    | `$now`, `$today`, `$year`, `$month`, `$day`, `$hour`, `$minute`, `$dayOfWeek`, `$timestamp`, `$formatDate`, `$daysBetween`                     |
| **Utility** | `$if`, `$default`, `$coalesce`, `$type`, `$isNull`, `$isNumber`, `$isString`, `$isBool`, `$isArray`, `$toNumber`, `$toString`, `$toBool`       |
| **Array**   | `$first`, `$last`, `$at`, `$slice`, `$reverse`, `$sort`, `$unique`, `$flatten`, `$count`, `$sum`, `$avg`, `$min`, `$max`                       |

### ❌ Remaining Gaps

| Gap                      | Impact                                       | Priority | Suggested Fix        |
| ------------------------ | -------------------------------------------- | -------- | -------------------- |
| **Object literals**      | Can't create `{ key: value }` in expressions | Medium   | Add parser support   |
| **Array literals**       | Can't create `[1, 2, 3]` in expressions      | Medium   | Add parser support   |
| **Array serialization**  | Arrays don't serialize to quads properly     | Low      | Improve serializer   |
| **Rollup filter AND/OR** | Only single comparisons                      | Medium   | Add compound filters |
| **Circular refs**        | No detection                                 | Low      | Add cycle detection  |
| **Watch mode relations** | Doesn't watch related files                  | Medium   | Track file deps      |

## Improvement Opportunities

### 1. Built-in Functions (High Value)

```jsonc
// Math
"sqrt": { "@expr": "$sqrt(16)" },
"abs": { "@expr": "$abs(-5)" },
"round": { "@expr": "$round(3.7)" },
"floor": { "@expr": "$floor(3.7)" },
"ceil": { "@expr": "$ceil(3.2)" },

// String
"lower": { "@expr": "$lower('HELLO')" },
"upper": { "@expr": "$upper('hello')" },
"trim": { "@expr": "$trim('  hello  ')" },
"len": { "@expr": "$len('hello')" },
"substr": { "@expr": "$substr(name, 0, 5)" },

// Date
"now": { "@expr": "$now()" },
"year": { "@expr": "$year($now())" },
"daysBetween": { "@expr": "$daysBetween(startDate, endDate)" }
```

### 2. Compound Rollup Filters

```jsonc
// Current: only single comparison
"filter": "status == 'active'"

// Proposed: compound filters
"filter": "status == 'active' && budget > 5000"
"filter": "role == 'developer' || role == 'designer'"
```

### 3. Array/Object Literals

```jsonc
// Create arrays
"tags": { "@expr": "[status, priority, assignee]" }

// Create objects
"summary": { "@expr": "{ total: sum, avg: sum / count }" }
```

### 4. Method Chaining

```jsonc
// String methods
"formatted": { "@expr": "name.toLowerCase().trim()" }

// Array methods
"filtered": { "@expr": "items.filter(x => x.active)" }
```

### 5. Null Coalescing

```jsonc
// Default values
"displayName": { "@expr": "nickname ?? name ?? 'Anonymous'" }
```

## Recommended Priority

1. **High**: Built-in functions (`$now`, `$round`, `$lower`, etc.)
2. **High**: Compound rollup filters
3. **Medium**: Null coalescing (`??`)
4. **Medium**: Object/array literals
5. **Low**: Method chaining
6. **Low**: Watch mode for relations

## Test Coverage

```
examples/
├── simple.data          # Basic arithmetic
├── budget.data          # Financial + ternary + strings
├── tasks.data           # Array operations
├── inventory.data       # Constraints + views
├── features.data        # Ternary, &&, ||, strings
├── projects.data        # Data source
├── team.data            # Data source
├── config.data          # Nested config source
├── dashboard.data       # Rollups + refs + expressions
├── ref-tests.data       # @ref comprehensive
├── rollup-tests.data    # @rollup comprehensive
├── stress-test.data     # All features combined
└── edge-cases.data      # Edge cases + error handling
```

All 13 example files pass evaluation.
