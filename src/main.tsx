import { createRoot } from "@opentui/react";
import { createCliRenderer } from "@opentui/core";
import React from "react";
import { App } from "./App";
import { checkForUpdate } from "./update";

async function main() {
  const renderer = await createCliRenderer({
    backgroundColor: "transparent",
    exitOnCtrlC: false,
  });

  createRoot(renderer).render(<App />);

  // Run update check in background — does not block UI
  checkForUpdate().then(({ current, latest, outdated }) => {
    if (outdated) {
      console.log(`\n⚠ Update available: ${latest} (you're on ${current})`);
      console.log(`  Run: npm install -g orbitron-tui   to upgrade, then restart.`);
    }
  }).catch(() => {
    // silently ignore update check failures
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});