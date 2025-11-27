#!/usr/bin/env bun
/**
 * Test a single fixture to debug runtime integration
 */

import { readFile } from "fs/promises";

async function testSingleFixture() {
  console.log("🔍 Testing single fixture: 01-expr-arithmetic\n");
  
  // Load fixture
  const input = JSON.parse(
    await readFile("./ldc/testkits/fixtures/01-expr-arithmetic/input.jsonld", "utf-8")
  );
  const expected = JSON.parse(
    await readFile("./ldc/testkits/fixtures/01-expr-arithmetic/expected.jsonld", "utf-8")
  );
  
  console.log("Input:", JSON.stringify(input, null, 2));
  console.log("\nExpected:", JSON.stringify(expected, null, 2));
  
  console.log("\n--- Testing runtime directly ---");
  
  try {
    // Import runtime directly
    const { evaluate } = await import("./runtime/src/index.js");
    
    console.log("Runtime imported successfully");
    console.log("Calling evaluate...");
    
    // Set a timeout
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Timeout after 2s")), 2000)
    );
    
    const evalPromise = evaluate(input, { baseIRI: "" });
    
    const result = await Promise.race([evalPromise, timeoutPromise]);
    
    console.log("\n✅ Evaluation completed!");
    console.log("Result:", JSON.stringify(result, null, 2));
    
  } catch (error: any) {
    console.error("\n❌ Error:", error.message);
    console.error(error.stack);
  }
}

testSingleFixture().catch(console.error);
