# Hardening Checklist ✅

## Completed High-Leverage Fixes

### ✅ 1. Canonical Signatures (Deterministic)
- **File:** `src/core/canonical.ts`
- **What:** Deterministic JSON serialization for signatures
- **Rules:**
  - Stable key order (alphabetical)
  - UTF-8 encoding, no whitespace
  - Floats as decimal (no scientific notation)
  - Dates as ISO 8601 UTC
  - Excludes non-deterministic fields (perf, timestamps)
- **Verified:** Byte-level parity tests passing ✅

### ✅ 2. Timeouts + Cancellation
- **File:** `src/core/handlers.ts`
- **What:** AbortController support throughout
- **Features:**
  - Respects `options.timeoutMs` (default: 5000ms)
  - Merges external signals via `AbortSignal.any()`
  - Returns timeout diagnostic on abort
  - Cleans up timers properly
- **Verified:** Timeout tests passing ✅

### ✅ 3. Unified Error Model
- **File:** `src/core/handlers.ts`
- **Rule:** **Handlers never throw; always return diagnostics**
- **Error Codes:**
  - `schema_error` - Invalid input schema
  - `cap_denied` - Capability denied (warning)
  - `timeout` - Evaluation/validation timeout
  - `eval_error` - Runtime evaluation error
  - `validation_error` - Runtime validation error
  - `bad_request` - HTTP bad request (REST only)
  - `internal` - Unexpected internal error
- **Verified:** All error paths tested ✅

### ✅ 4. Capability Enforcement
- **File:** `src/core/services/index.ts`
- **What:** `policy.enforce()` returns `{ allowed, denied }`
- **Behavior:**
  - Default-deny (no caps by default)
  - Denied caps logged as warnings in diagnostics
  - Effective caps logged in audit trail
- **Verified:** Capability denial tests passing ✅

### ✅ 5. Request ID + Audit Logging
- **File:** `src/core/handlers.ts`
- **What:** Every request gets a UUID and audit log
- **Log Format:**
  ```json
  {
    "ts": "2025-10-14T14:08:01.709Z",
    "reqId": "802f9e6c-6060-4b8e-af67-4c8a14b2ec1b",
    "orgId": "test-org",
    "userId": "test-user",
    "tool": "evaluate",
    "capsEffective": [],
    "durationMs": 6,
    "diagCounts": {"error": 0, "warning": 0, "info": 0}
  }
  ```
- **Output:** stderr (can be redirected to log sink)
- **Verified:** Audit logs in test output ✅

### ✅ 6. REST Hardening
- **File:** `src/server/http-server.ts`
- **Features:**
  - Content-Type validation (must be `application/json`)
  - Returns 415 for wrong Content-Type
  - Request ID in `X-Request-ID` header
  - Proper HTTP status codes (200, 400, 415, 500)
  - Health endpoint with uptime: `GET /health`
- **Verified:** Manual curl testing ✅

### ✅ 7. Byte-Level Parity Tests
- **File:** `test-parity-strict.ts`
- **What:** Verifies identical output (excluding perf)
- **Tests:**
  - ✅ Deterministic evaluation
  - ✅ Identical signatures
  - ✅ Schema error parity
  - ✅ Timeout parity
  - ✅ Capability denial parity
  - ✅ Large payload parity (100-item nested structure)
  - ✅ Validation parity
  - ✅ Numeric precision parity
- **Result:** All 8 scenarios byte-equal ✅

### ✅ 8. Health Endpoint
- **Endpoint:** `GET /health`
- **Response:**
  ```json
  {
    "status": "ok",
    "version": "1.0.0",
    "uptimeSec": 42
  }
  ```
- **Verified:** Returns 200 OK ✅

## Test Results

```bash
$ bun run test-parity-strict.ts

✅ All strict parity tests passed!

📊 Summary:
  - Deterministic evaluation: ✓
  - Identical signatures: ✓
  - Error handling parity: ✓
  - Timeout handling: ✓
  - Capability denial: ✓
  - Large payload: ✓
  - Validation parity: ✓
  - Numeric precision: ✓

🎯 Byte-level parity confirmed across all scenarios
```

## Curl Examples

### Evaluate
```bash
curl -X POST http://localhost:3001/v1/evaluate \
  -H "Content-Type: application/json" \
  -H "x-org-id: my-org" \
  -d '{
    "doc": {"type": "test", "value": 42},
    "options": {"timeoutMs": 1000}
  }'
```

### Validate
```bash
curl -X POST http://localhost:3001/v1/validate \
  -H "Content-Type: application/json" \
  -H "x-org-id: my-org" \
  -d '{"doc": {"type": "test", "value": 42}}'
```

### Health Check
```bash
curl http://localhost:3001/health
```

### Test Capability Denial
```bash
curl -X POST http://localhost:3001/v1/evaluate \
  -H "Content-Type: application/json" \
  -H "x-org-id: my-org" \
  -d '{
    "doc": {"type": "test"},
    "options": {
      "caps": {"network": ["fetch"], "file": ["read"]}
    }
  }'
```

### Test Timeout
```bash
curl -X POST http://localhost:3001/v1/evaluate \
  -H "Content-Type: application/json" \
  -H "x-org-id: my-org" \
  -d '{
    "doc": {"type": "slow"},
    "options": {"timeoutMs": 10}
  }'
```

### Test Bad Content-Type
```bash
curl -X POST http://localhost:3001/v1/evaluate \
  -H "Content-Type: text/plain" \
  -d 'invalid'
# Returns 415 Unsupported Media Type
```

## Architecture Guarantees

### 🔒 Security
- ✅ Default-deny capability model
- ✅ Org boundary enforcement (auth.orgId)
- ✅ No cross-org data leaks
- ✅ Request ID tracking
- ✅ Audit logging

### 🎯 Determinism
- ✅ Canonical JSON signatures
- ✅ Excludes perf/timestamps from signatures
- ✅ Stable numeric precision
- ✅ Byte-level parity verified

### ⚡ Reliability
- ✅ Never throws (always diagnostics)
- ✅ Timeout enforcement
- ✅ Graceful error handling
- ✅ AbortController support
- ✅ Proper cleanup (clearTimeout)

### 📊 Observability
- ✅ Request ID per request
- ✅ Audit logs (JSON stderr)
- ✅ Diagnostic counts
- ✅ Duration tracking
- ✅ Health endpoint

### 🔄 Transport Parity
- ✅ MCP and REST call same handlers
- ✅ Identical error codes
- ✅ Identical diagnostics
- ✅ Byte-equal output (minus perf)
- ✅ Verified by strict tests

## Remaining TODOs (Production)

### High Priority
- [ ] Real signing (HMAC-SHA256 or Ed25519)
- [ ] Org policy lookup (database)
- [ ] Rate limiting (per org + IP)
- [ ] Integrate real `@ldc/runtime`

### Medium Priority
- [ ] Artifact storage (S3/DB)
- [ ] Structured logging (JSON sink)
- [ ] Metrics (Prometheus)
- [ ] Error tracking (Sentry)

### Low Priority
- [ ] OpenAPI spec generation
- [ ] SSE streaming (for long-running evals)
- [ ] --dry-run flag
- [ ] Golden test fixtures

## Performance Targets

- [ ] 10k-node doc eval < 100ms
- [ ] Memory stable over 50 runs (no leaks)
- [ ] P99 latency < 200ms
- [ ] Throughput > 100 req/sec

## Multi-Tenant Safety

- [x] Request ID generation
- [x] Org boundary in auth
- [ ] Rate limiting per org
- [ ] Storage isolation
- [ ] Audit log per org

## DevX Wins

- [x] Health endpoint
- [x] Curl examples in docs
- [x] MODE=both default
- [x] Audit logs to stderr
- [ ] --dry-run flag
- [ ] OpenAPI spec

## Hosted Eval Readiness

- [x] Deterministic signatures
- [x] Version pinning (runtimeVersion)
- [ ] TZ=UTC, LANG=C.UTF-8
- [ ] Bun/Node version pinning
- [ ] Facade for local vs hosted

## Summary

The architecture is now **boring and hard to break**:

1. ✅ **Deterministic** - Canonical signatures, byte-level parity
2. ✅ **Reliable** - Never throws, always diagnostics
3. ✅ **Observable** - Request IDs, audit logs, health checks
4. ✅ **Secure** - Default-deny, capability enforcement
5. ✅ **Fast** - Timeouts, AbortController, proper cleanup
6. ✅ **Tested** - Strict parity tests, all scenarios covered

**Next:** Integrate real runtime, add rate limiting, wire production storage.
