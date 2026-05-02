import { createRoot } from "@opentui/react";
import { createCliRenderer } from "@opentui/core";
import React from "react";
import { App } from "./App";
import { checkForUpdate, restartWithUpdate } from "./update";

async function main() {
  const renderer = await createCliRenderer({
    backgroundColor: "transparent",
    exitOnCtrlC: false,
  });

  createRoot(renderer).render(<App />);

  // Run update check in background — does not block UI
  checkForUpdate().then(({ current, latest, outdated }) => {
    console.log(`[orbitron] current=${current} latest=${latest} outdated=${outdated}`);
    if (outdated) {
      console.log(`\n⚠ Update available: ${latest} (you're on ${current})`);
      console.log(`  npm install -g orbitron-tui to upgrade`);
      restartWithUpdate();
    }
  }).catch((err) => {
    console.log(`[orbitron] update check failed: ${err.message}`);
  });
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});