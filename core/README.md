# LD-C MCP + REST Server

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6)

**Unified MCP + REST server for LD-C evaluation** with a shared core. Both transports call the same handlers, ensuring zero drift.

> **Architecture Philosophy**: "MCP vs REST is a transport detail, not an architectural fork."

## 🎯 Quick Start

```bash
# Install dependencies
bun install

# Run parity tests
bun run test-parity.ts

# Start in HTTP mode (REST API)
bun run dev:http

# Start in MCP mode (stdio)
bun run dev:mcp

# Start both (MCP via SSE + HTTP)
bun run dev
```

## 📖 What's This?

This server provides **LD-C document evaluation and validation** through two transports:

1. **REST HTTP API** - For web clients, curl, fetch, etc.
2. **MCP Protocol** - For AI assistants (Claude, Cursor, etc.)

Both transports:
- ✅ Call the same `core/handlers.ts`
- ✅ Use the same Zod schemas
- ✅ Enforce the same policies
- ✅ Return identical JSON
- ✅ Are tested for parity

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for detailed design docs.

## 🚀 Usage

### HTTP REST API

Start the HTTP server:

```bash
bun run dev:http
# Server runs on http://localhost:3001
```

**Endpoints:**

```bash
# Evaluate an LD-C document
curl -X POST http://localhost:3001/v1/evaluate \
  -H "Content-Type: application/json" \
  -H "x-org-id: my-org" \
  -d '{
    "doc": {"type": "test", "value": 42},
    "options": {"timeoutMs": 1000}
  }'

# Validate an LD-C document
curl -X POST http://localhost:3001/v1/validate \
  -H "Content-Type: application/json" \
  -H "x-org-id: my-org" \
  -d '{"doc": {"type": "test", "value": 42}}'

# Health check
curl http://localhost:3001/health
```

**Headers:**
- `x-org-id` - Organization ID (default: "public")
- `x-user-id` - User ID (optional)
- `x-api-key-id` - API Key ID (optional)

### MCP Protocol

Start the MCP server:

```bash
# stdio mode (for MCP clients)
bun run dev:mcp

# SSE mode (for web-based MCP clients)
MODE=both bun run dev
# MCP available at http://localhost:3002/sse
```

**Tools:**
- `ldc.evaluate` - Evaluate LD-C document with provenance
- `ldc.validate` - Validate LD-C document structure
- `hello_world` - Legacy greeting tool
- `goodbye` - Legacy farewell tool

**Resources:**
- `ldc://artifacts/{orgId}` - List all artifacts
- `ldc://artifact/{orgId}/{id}` - Get specific artifact

### Connecting from Cursor/Claude

Add to your `.cursor/mcp.json` or Claude Desktop config:

```json
{
  "mcpServers": {
    "ldc-server": {
      "command": "bun",
      "args": ["run", "dev:mcp"],
      "cwd": "/path/to/ldc/core",
      "env": {
        "MODE": "mcp"
      }
    }
  }
}
```

Or for SSE mode:

```json
{
  "mcpServers": {
    "ldc-server-sse": {
      "url": "http://localhost:3002/sse"
    }
  }
}
```

## 📁 Project Structure

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
├── ARCHITECTURE.md            # Detailed architecture docs
├── package.json
└── tsconfig.json
```

## 🧪 Testing

Run parity tests to verify both transports produce identical results:

```bash
bun run test-parity.ts
```

This verifies:
1. ✅ Handlers return correct structure
2. ✅ Deterministic signatures
3. ✅ Error handling
4. ✅ Both transports call same code

## 🔧 Environment Variables

- `MODE` - Server mode: `mcp`, `http`, or `both` (default: `both`)
- `PORT` - HTTP server port (default: `3001`)
- `MCP_PORT` - MCP SSE port (default: `3002`)

## 📚 Available Scripts

```bash
# Development (both MCP + HTTP)
bun run dev

# Development (HTTP only)
bun run dev:http

# Development (MCP only)
bun run dev:mcp

# Production
bun run start          # Both
bun run start:http     # HTTP only
bun run start:mcp      # MCP only
bun run start:both     # Both

# Build
bun run build
```

## 🏗️ Architecture Highlights

### Single Source of Truth

All business logic lives in `core/handlers.ts`. Adapters are thin wrappers:

```typescript
// ✅ CORRECT: Adapter calls handler
server.addTool({
  name: "ldc.evaluate",
  execute: async (params) => {
    const result = await evaluate(params); // Handler does the work
    return JSON.stringify(result);
  }
});
```

### Schema-First Design

Zod schemas in `core/schema.ts` define contracts used by both transports:

```typescript
export const EvalInput = z.object({
  doc: z.record(z.any()),
  options: EvalOptions.optional(),
  auth: Auth
});
```

### Dependency Injection

`makeServices()` wires runtime, storage, signing, and policy:

```typescript
export function makeServices() {
  return {
    runtime: { evaluate, validate },
    signer: { sign },
    policy: { enforce },
    storage: { listArtifacts, getArtifact }
  };
}
```

### Default-Deny Security

Capability-based security enforced in handlers:

```typescript
const caps = policy.enforce(auth, requestedCaps ?? {}); // Default: no caps
const result = await runtime.evaluate(doc, { ...options, caps });
```

## 🛣️ Next Steps

1. **Integrate `@ldc/runtime`** - Replace mock runtime in `services/index.ts`
2. **Add real signing** - Implement HMAC/Ed25519 in `signer.sign()`
3. **Implement policy** - Add org-level capability enforcement
4. **Add storage** - Wire S3/DB for artifact persistence
5. **Golden tests** - Create test fixtures for regression testing
6. **OpenAPI spec** - Generate from Zod schemas for REST API

## 📖 Documentation

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - Detailed architecture and design philosophy
- **[FastMCP Docs](https://github.com/punkpeye/fastmcp)** - FastMCP framework documentation
- **[MCP Specification](https://modelcontextprotocol.io/)** - Model Context Protocol spec

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.
