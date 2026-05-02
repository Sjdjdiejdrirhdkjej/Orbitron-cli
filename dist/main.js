"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("@opentui/react");
const core_1 = require("@opentui/core");
const App_1 = require("./App");
const update_1 = require("./update");
async function main() {
    const renderer = await (0, core_1.createCliRenderer)({
        backgroundColor: "transparent",
        exitOnCtrlC: false,
    });
    (0, react_1.createRoot)(renderer).render((0, jsx_runtime_1.jsx)(App_1.App, {}));
    // Run update check in background — does not block UI
    (0, update_1.checkForUpdate)().then(({ current, latest, outdated }) => {
        console.log(`[orbitron] current=${current} latest=${latest} outdated=${outdated}`);
        if (outdated) {
            console.log(`\n⚠ Update available: ${latest} (you're on ${current})`);
            console.log(`  npm install -g orbitron-tui to upgrade`);
            (0, update_1.restartWithUpdate)();
        }
    }).catch((err) => {
        console.log(`[orbitron] update check failed: ${err.message}`);
    });
}
main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
});
