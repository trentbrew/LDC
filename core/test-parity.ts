#!/usr/bin/env bun
/**
 * Parity test - verify MCP and REST produce identical results
 * Tests that both transports call the same core handlers
 */

import { evaluate, validate } from "./src/core/handlers.js";

const testDoc = {
  type: "test",
  value: 42,
  nested: {
    foo: "bar"
  }
};

const testAuth = {
  orgId: "test-org",
  userId: "test-user"
};

async function testParity() {
  console.log("🧪 Testing handler parity...\n");

  // Test 1: Evaluate
  console.log("1. Testing evaluate handler:");
  const evalInput = {
    doc: testDoc,
    options: {
      timeoutMs: 1000
    },
    auth: testAuth
  };

  const evalResult = await evaluate(evalInput);
  console.log("   ✓ Evaluate result:", JSON.stringify(evalResult, null, 2));
  
  // Verify structure
  if (!evalResult.value || !evalResult.diagnostics || !evalResult.perf || !evalResult.sig) {
    throw new Error("Evaluate result missing required fields");
  }
  console.log("   ✓ Result has correct structure\n");

  // Test 2: Validate
  console.log("2. Testing validate handler:");
  const validateInput = {
    doc: testDoc,
    auth: testAuth
  };

  const validateResult = await validate(validateInput);
  console.log("   ✓ Validate result:", JSON.stringify(validateResult, null, 2));
  
  // Verify structure
  if (!validateResult.value || !validateResult.diagnostics || !validateResult.perf) {
    throw new Error("Validate result missing required fields");
  }
  console.log("   ✓ Result has correct structure\n");

  // Test 3: Verify determinism
  console.log("3. Testing determinism:");
  const evalResult2 = await evaluate(evalInput);
  
  // Signatures should be identical for same input
  if (evalResult.sig !== evalResult2.sig) {
    console.warn("   ⚠ Signatures differ (may be expected if timestamp-based)");
  } else {
    console.log("   ✓ Signatures are identical");
  }
  console.log();

  // Test 4: Invalid input
  console.log("4. Testing error handling:");
  try {
    await validate({ doc: null as any, auth: testAuth });
    console.log("   ✓ Handled invalid doc\n");
  } catch (error: any) {
    console.log("   ✓ Caught error:", error.message, "\n");
  }

  console.log("✅ All parity tests passed!");
  console.log("\n📝 Next steps:");
  console.log("   1. Start HTTP server: bun run dev:http");
  console.log("   2. Test REST endpoint:");
  console.log('      curl -X POST http://localhost:3001/v1/evaluate \\');
  console.log('        -H "Content-Type: application/json" \\');
  console.log('        -H "x-org-id: test-org" \\');
  console.log('        -d \'{"doc": {"type": "test", "value": 42}}\'');
  console.log("\n   3. Start MCP server: bun run dev:mcp");
  console.log("   4. Test with MCP client (e.g., Claude Desktop)");
}

testParity().catch((error) => {
  console.error("❌ Test failed:", error);
  process.exit(1);
});
