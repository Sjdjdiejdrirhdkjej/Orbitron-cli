import { listModels, streamChat } from "./api/chat";
import { useChatStore } from "./store/chat-store";

export async function initializeBackendClient() {
  const store = useChatStore.getState();
  
  // Set up backend health check
  store.checkHealth();
  
  // Load models
  try {
    const models = await listModels(store.config.baseUrl);
    store.setAvailableModels(models);
    
    // Set default model if not already set
    if (!store.config.model && models.length > 0) {
      store.setConfig({ model: models[0].id });
    }
  } catch (error) {
    store.setLastError(`Failed to load models: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function sendMessageToBackend(content: string) {
  const store = useChatStore.getState();
  const { baseUrl, apiKey, model, temperature, maxTokens } = store.config;
  
  if (!model) {
    throw new Error("No model selected");
  }
  
  const messages = store.messages.map(msg => ({
    role: msg.role,
    content: msg.content
  }));
  
  const abortController = new AbortController();
  
  try {
    const stream = streamChat({
      baseUrl,
      apiKey,
      model,
      messages,
      temperature,
      maxTokens,
      signal: abortController.signal
    });
    
    for await (const chunk of stream) {
      store.appendStreamingContent(chunk);
    }
    
    // Add the assistant message to the store
    const assistantMessage = {
      role: "assistant",
      content: store.streamingContent
    } as const;
    
    store.addMessage(assistantMessage);
    store.setStreamingContent("");
    
  } catch (error) {
    store.setLastError(`Failed to send message: ${error instanceof Error ? error.message : String(error)}`);
    store.addMessage({
      role: "assistant",
      content: `Error: ${error instanceof Error ? error.message : String(error)}`,
      failed: true
    });
    throw error;
  }
}