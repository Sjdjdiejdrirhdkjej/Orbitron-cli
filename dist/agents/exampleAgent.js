"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.exampleAgent = void 0;
const message_1 = require("../sdk/message");
exports.exampleAgent = {
    name: "ExampleAgent",
    async execute(message) {
        const processedMessage = await (0, message_1.processMessage)(message);
        await (0, message_1.sendMessage)(processedMessage);
        return processedMessage;
    }
};
