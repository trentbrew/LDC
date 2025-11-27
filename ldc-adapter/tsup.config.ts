import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/instantdb.ts', 'src/types.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
});
