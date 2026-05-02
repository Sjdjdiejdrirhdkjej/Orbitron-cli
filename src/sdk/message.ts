export interface Message {
  id: string;
  content: string;
  timestamp: Date;
  sender: string;
}

export const sendMessage = async (message: Message): Promise<void> => {
  console.log("Sending message:", message);
};

export const processMessage = async (message: Message): Promise<Message> => {
  console.log("Processing message:", message);
  return { ...message, content: `Processed: ${message.content}` };
};

export const receiveMessage = async (): Promise<Message> => {
  return {
    id: "1",
    content: "Example message",
    timestamp: new Date(),
    sender: "system"
  };
};
