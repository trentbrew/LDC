#!/usr/bin/env bun

console.log("1. Starting...");

console.log("2. Importing evaluator directly...");
import { Evaluator } from "./runtime/src/core/evaluator.js";

console.log("3. Evaluator imported:", typeof Evaluator);

console.log("4. Done");
export {};
