#!/usr/bin/env bun
/**
 * Test if we can even import the runtime
 */

console.log("Step 1: Starting import test...");

try {
  console.log("Step 2: Attempting to import runtime...");
  const runtime = await import("./runtime/src/index.js");
  console.log("Step 3: Runtime imported!");
  console.log("Exports:", Object.keys(runtime));
} catch (error: any) {
  console.error("Step X: Import failed:", error.message);
  console.error(error.stack);
}

console.log("Step 4: Done");
