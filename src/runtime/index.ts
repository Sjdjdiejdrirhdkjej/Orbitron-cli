import { exampleAgent } from "../agents/exampleAgent";
import { Message, receiveMessage } from "../sdk/message";

export const runRuntime = async (): Promise<void> => {
  const message = await receiveMessage();
  const result = await exampleAgent.execute(message);
  console.log("Runtime result:", result);
};
