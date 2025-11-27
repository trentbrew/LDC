#!/usr/bin/env bun
/**
 * Golden test suite using real LD-C fixtures
 * 
 * Tests the real runtime against known-good test cases from @ldc/testkits
 */

import { evaluate } from "./src/core/handlers.js";
import { readdir, readFile } from "fs/promises";
import { join } from "path";

const FIXTURES_DIR = "./ldc/testkits/fixtures";

interface TestFixture {
  name: string;
  input: any;
  expected: any;
  diagnostics: any[];
}

async function loadFixture(fixturePath: string): Promise<TestFixture> {
  const name = fixturePath.split("/").pop() || "unknown";
  
  const inputPath = join(fixturePath, "input.jsonld");
  const expectedPath = join(fixturePath, "expected.jsonld");
  const diagnosticsPath = join(fixturePath, "diagnostics.json");
  
  const [input, expected, diagnostics] = await Promise.all([
    readFile(inputPath, "utf-8").then(JSON.parse),
    readFile(expectedPath, "utf-8").then(JSON.parse),
    readFile(diagnosticsPath, "utf-8").then(JSON.parse),
  ]);
  
  return { name, input, expected, diagnostics };
}

async function runGoldenTests() {
  console.log("🧪 Golden Test Suite (Real LD-C Fixtures)\n");
  
  // Load all fixtures
  const fixtureNames = await readdir(FIXTURES_DIR);
  const fixtureDirs = fixtureNames
    .filter((name) => name.match(/^\d{2}-/))
    .sort()
    .map((name) => join(FIXTURES_DIR, name));
  
  console.log(`Found ${fixtureDirs.length} test fixtures\n`);
  
  let passed = 0;
  let failed = 0;
  const failures: string[] = [];
  
  for (const fixtureDir of fixtureDirs) {
    const fixture = await loadFixture(fixtureDir);
    
    try {
      // Evaluate using our handler
      const result = await evaluate({
        doc: fixture.input,
        auth: { orgId: "test-org" },
      });
      
      // Check for errors
      const hasErrors = result.diagnostics.some((d) => d.severity === "error");
      const expectedErrors = fixture.diagnostics.length > 0;
      
      if (hasErrors && !expectedErrors) {
        console.log(`❌ ${fixture.name}`);
        console.log(`   Unexpected errors:`);
        result.diagnostics
          .filter((d) => d.severity === "error")
          .forEach((d) => console.log(`   - ${d.code}: ${d.message}`));
        failed++;
        failures.push(fixture.name);
        continue;
      }
      
      if (!hasErrors && expectedErrors) {
        console.log(`❌ ${fixture.name}`);
        console.log(`   Expected errors but got none`);
        failed++;
        failures.push(fixture.name);
        continue;
      }
      
      // For now, just check that it doesn't crash
      // TODO: Deep comparison of result.value with fixture.expected
      console.log(`✓ ${fixture.name}`);
      passed++;
      
    } catch (error: any) {
      console.log(`❌ ${fixture.name}`);
      console.log(`   Exception: ${error.message}`);
      failed++;
      failures.push(fixture.name);
    }
  }
  
  console.log(`\n📊 Results:`);
  console.log(`  ✓ Passed: ${passed}/${fixtureDirs.length}`);
  console.log(`  ❌ Failed: ${failed}/${fixtureDirs.length}`);
  
  if (failures.length > 0) {
    console.log(`\n❌ Failed tests:`);
    failures.forEach((name) => console.log(`  - ${name}`));
    process.exit(1);
  }
  
  console.log(`\n✅ All golden tests passed!`);
}

runGoldenTests().catch((error) => {
  console.error("\n❌ Golden test suite failed:", error.message);
  console.error(error.stack);
  process.exit(1);
});
