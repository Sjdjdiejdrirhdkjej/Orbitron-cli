import React from "react";
import { ChatScreen } from "./screens/chat-screen";
import { ModelPicker } from "./screens/model-picker";

export function App() {
  return (
    <box
      style={{
        width: "100%",
        height: "100%",
        backgroundColor: "transparent",
        flexDirection: "column",
      }}
    >
      <ChatScreen />
      <ModelPicker />
    </box>
  );
}