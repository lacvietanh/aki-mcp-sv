#!/usr/bin/env node
import { main } from '../scripts/agy-pool-config.js';

try {
  main();
} catch (error) {
  console.error(error?.message || error);
  process.exitCode = 1;
}
