# @ldc/runtime

Core LD-C runtime: evaluator, AST, DAG, diagnostics.

## Installation

```bash
npm install @ldc/runtime
# or
pnpm add @ldc/runtime
```

## Usage

```typescript
import { evaluate, validate } from '@ldc/runtime';

const model = {
  "@context": {...},
  "revenue": 100000,
  "growth": 0.15,
  "nextMonth": {"@expr": "revenue * (1 + growth)"}
};

const result = await evaluate(model, {now: new Date()});
// result.nextMonth === 115000, with full provenance
```

## Features

- **Expression Evaluation**: Compute values from LD-C expressions
- **DAG Construction**: Build dependency graphs for reactive updates
- **Type Validation**: Ensure model correctness
- **Provenance Tracking**: Track computation origins
- **Error Diagnostics**: Detailed error messages with source locations

## API

### `evaluate(model, context?)`

Evaluates an LD-C model and returns computed values.

### `validate(model)`

Validates an LD-C model against the specification.

## License

MIT
