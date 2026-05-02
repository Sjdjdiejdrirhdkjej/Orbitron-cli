"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.App = App;
const jsx_runtime_1 = require("react/jsx-runtime");
const chat_screen_1 = require("./screens/chat-screen");
const model_picker_1 = require("./screens/model-picker");
function App() {
    return ((0, jsx_runtime_1.jsxs)("box", { style: {
            width: "100%",
            height: "100%",
            backgroundColor: "transparent",
            flexDirection: "column",
        }, children: [(0, jsx_runtime_1.jsx)(chat_screen_1.ChatScreen, {}), (0, jsx_runtime_1.jsx)(model_picker_1.ModelPicker, {})] }));
}
