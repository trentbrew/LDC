/**
 * @ldc/adapter - Thin adapter layer for LD-C computation over various backends
 * 
 * This package provides a runtime-agnostic contract for executing LD-C queries
 * with full provenance tracking. It reuses @ldc/datatable-core for zero-drift
 * computation between UI and agent queries.
 */

export * from './types';
export { InstantDBLdcAdapter } from './instantdb';
export type { InstantDBConnection } from './instantdb';
