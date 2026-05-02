import { Message, sendMessage, processMessage } from "../sdk/message";

export const exampleAgent = {
  name: "ExampleAgent",
  async execute(message: Message): Promise<Message> {
    const processedMessage = await processMessage(message);
    await sendMessage(processedMessage);
    return processedMessage;
  }
};
