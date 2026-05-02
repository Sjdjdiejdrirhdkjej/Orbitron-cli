"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runRuntime = void 0;
const exampleAgent_1 = require("../agents/exampleAgent");
const message_1 = require("../sdk/message");
const runRuntime = async () => {
    const message = await (0, message_1.receiveMessage)();
    const result = await exampleAgent_1.exampleAgent.execute(message);
    console.log("Runtime result:", result);
};
exports.runRuntime = runRuntime;
