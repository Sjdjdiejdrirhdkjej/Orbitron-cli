#!/usr/bin/env node
import path from "node:path";
import { spawnSync } from "node:child_process";
const bin = path.join(import.meta.dirname, "..", "dist", "orbitron");
const result = spawnSync(bin, process.argv.slice(2), { stdio: "inherit" });
process.exit(result.status ?? 0);
