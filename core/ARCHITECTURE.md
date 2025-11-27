# LD-C MCP + REST Architecture

## Overview

This is a **unified MCP + REST server** with a shared core. Both transports (MCP and HTTP) call the same handlers, ensuring **zero drift** between them.

```
┌─────────────────────────────────────────────────┐
│                   Clients                       │
├──────────────────┬──────────────────────────────┤
│   MCP Clients    │      HTTP Clients            │
│  (Claude, etc)   │   (curl, fetch, etc)         │
└────────┬─────────┴──────────────┬───────────────┘
         │                        │
         ▼                        ▼
┌─────────────────┐      ┌─────────────────┐
│  MCP Adapter    │      │  REST Adapter   │
│ (tools/resources)│      │  (HTTP routes)  │
└────────┬─────────┘      └────────┬────────┘
         │                         │
         └────────┬────────────────┘
                  ▼
         ┌─────────────────┐
         │  Core Handlers  │
         │  (evaluate,     │
         │   validate)     │
         └────────┬────────┘
                  ▼
         ┌─────────────────┐
         │    Services     │
         │  (runtime,      │
         │   signer,       │
         │   policy,       │
         │   storage)      │
         └─────────────────┘
```

## Directory Structure

```
.
├── src/
│   ├── core/                  # Transport-agnostic logic
│   │   ├── schema.ts          # Zod schemas (single source of truth)
│   │   ├── handlers.ts        # evaluate() & validate() - core business logic
│   │   ├── tools.ts           # MCP tool wrappers (thin)
│   │   ├── resources.ts       # MCP resources (artifacts)
│   │   ├── prompts.ts         # MCP prompts
│   │   └── services/
│   │       ├── index.ts       # DI container (makeServices)
│   │       └── greeting-service.ts
│   ├── server/
│   │   ├── http-server.ts     # REST adapter (Bun HTTP)
│   │   └── server.ts          # MCP adapter (FastMCP)
│   └── index.ts               # CLI entry (mode switching)
├── test-parity.ts             # Parity tests
├── package.json
└── tsconfig.json
```

## Core Principles

### 1. Single Source of Truth

**All business logic lives in `core/handlers.ts`**. Adapters are thin wrappers.

```typescript
// ✅ CORRECT: Adapter calls handler
server.addTool({
  name: "ldc.evaluate",
  execute: async (params) => {
    const result = await evaluate(params); // Handler does the work
    return JSON.stringify(result);
  }
});

// ❌ WRONG: Logic in adapter
server.addTool({
  name: "ldc.evaluate",
  execute: async (params) => {
    // Don't put business logic here!
    const result = await runtime.evaluate(...);
    return result;
  }
});
```

### 2. Schema-First Design

Zod schemas in `core/schema.ts` define contracts. Both adapters use the same schemas.

```typescript
// core/schema.ts
export const EvalInput = z.object({
  doc: z.record(z.any()),
  options: EvalOptions.optional(),
  auth: Auth
});

// Used by both:
// - REST: EvalInput.parse({ ...body, auth })
// - MCP:  EvalInput.parse({ ...params, auth })
```

### 3. Dependency Injection

`makeServices()` wires runtime, storage, signing, and policy. Easy to swap for testing.

```typescript
// core/services/index.ts
export function makeServices() {
  return {
    runtime: { evaluate, validate },
    signer: { sign },
    policy: { enforce },
    storage: { listArtifacts, getArtifact }
  };
}
```

### 4. Default-Deny Security

Capability-based security enforced in handlers, not adapters.

```typescript
// core/handlers.ts
const caps = policy.enforce(auth, requestedCaps ?? {}); // Default: no caps
const result = await runtime.evaluate(doc, { ...options, caps });
```

## Running the Server

### Mode 1: HTTP Only (REST API)

```bash
bun run dev:http
# or
MODE=http bun run src/index.ts
```

Endpoints:
- `POST /v1/evaluate` - Evaluate LD-C document
- `POST /v1/validate` - Validate LD-C document
- `GET /health` - Health check

Example:
```bash
curl -X POST http://localhost:3001/v1/evaluate \
  -H "Content-Type: application/json" \
  -H "x-org-id: my-org" \
  -d '{"doc": {"type": "test", "value": 42}}'
```

### Mode 2: MCP Only (stdio)

```bash
bun run dev:mcp
# or
MODE=mcp bun run src/index.ts
```

Tools:
- `ldc.evaluate` - Evaluate LD-C document
- `ldc.validate` - Validate LD-C document
- `hello_world` - Legacy greeting tool
- `goodbye` - Legacy farewell tool

Resources:
- `ldc://artifacts/{orgId}` - List artifacts
- `ldc://artifact/{orgId}/{id}` - Get artifact

### Mode 3: Both (MCP via SSE + HTTP)

```bash
bun run dev
# or
MODE=both bun run src/index.ts
```

- HTTP REST: `http://localhost:3001`
- MCP SSE: `http://localhost:3002/sse`

## Testing Parity

Run the parity test to verify both transports produce identical results:

```bash
bun run test-parity.ts
```

This tests:
1. ✅ Handlers return correct structure
2. ✅ Deterministic signatures
3. ✅ Error handling
4. ✅ Both transports call same code

## Adding New Functionality

### Step 1: Define Schema

```typescript
// core/schema.ts
export const MyInput = z.object({
  foo: z.string(),
  auth: Auth
});
```

### Step 2: Implement Handler

```typescript
// core/handlers.ts
export async function myHandler(input: MyInputT): Promise<MyOutputT> {
  const { foo, auth } = MyInput.parse(input);
  const { runtime } = makeServices();
  
  // Business logic here
  const result = await runtime.doSomething(foo);
  
  return MyOutput.parse(result);
}
```

### Step 3: Add MCP Tool

```typescript
// core/tools.ts
server.addTool({
  name: "my.tool",
  parameters: z.object({
    foo: z.string(),
    orgId: z.string().optional()
  }),
  execute: async (params) => {
    const auth = { orgId: params.orgId ?? "public" };
    const result = await myHandler({ foo: params.foo, auth });
    return JSON.stringify(result);
  }
});
```

### Step 4: Add REST Endpoint

```typescript
// server/http-server.ts
if (url.pathname === "/v1/my-endpoint" && req.method === "POST") {
  const body = await req.json();
  const auth = { orgId: req.headers.get("x-org-id") ?? "public" };
  const result = await myHandler({ ...body, auth });
  return new Response(JSON.stringify(result), { headers });
}
```

### Step 5: Test Parity

Add test to `test-parity.ts`:

```typescript
const result1 = await myHandler({ foo: "test", auth: testAuth });
const result2 = await myHandler({ foo: "test", auth: testAuth });
assert.deepEqual(result1, result2); // Deterministic
```

## Environment Variables

- `MODE` - Server mode: `mcp`, `http`, or `both` (default: `both`)
- `PORT` - HTTP server port (default: `3001`)
- `MCP_PORT` - MCP SSE port (default: `3002`)

## Next Steps

1. **Integrate `@ldc/runtime`** - Replace mock runtime in `services/index.ts`
2. **Add real signing** - Implement HMAC/Ed25519 in `signer.sign()`
3. **Implement policy** - Add org-level capability enforcement
4. **Add storage** - Wire S3/DB for artifact persistence
5. **Golden tests** - Create test fixtures for regression testing
6. **OpenAPI spec** - Generate from Zod schemas for REST API

## Key Files

- **`core/schema.ts`** - All Zod schemas (contracts)
- **`core/handlers.ts`** - All business logic (evaluate, validate)
- **`core/services/index.ts`** - DI container (makeServices)
- **`server/http-server.ts`** - REST adapter (thin)
- **`server/server.ts`** - MCP adapter (thin)
- **`index.ts`** - CLI entry (mode switching)

## Design Philosophy

> **"MCP vs REST is a transport detail, not an architectural fork."**

Both transports:
- ✅ Call the same handlers
- ✅ Use the same schemas
- ✅ Enforce the same policies
- ✅ Return identical JSON (minus transport metadata)
- ✅ Are tested for parity

This ensures:
- 🚀 No feature drift between transports
- 🧪 Easy testing (test handlers, not transports)
- 🔧 Easy maintenance (one codebase)
- 📦 Easy deployment (one binary, multiple modes)
