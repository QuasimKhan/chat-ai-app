import type { Channel, Event, MessageResponse, StreamChat } from "stream-chat";
import { GoogleGenerativeAI } from "@google/generative-ai";

export class GeminiResponseHandler {
  private message_text = "";
  private is_done = false;
  private last_update_time = 0;

  constructor(
    private readonly genAI: GoogleGenerativeAI,
    private readonly chatClient: StreamChat,
    private readonly channel: Channel,
    private readonly message: MessageResponse,
    private readonly prompt: string,
    private readonly onDispose: () => void
  ) {
    this.chatClient.on("ai_indicator.stop", this.handleStopGenerating);
  }

  run = async () => {
    const { cid, id: message_id } = this.message;
    const model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    try {
      const result = await model.generateContentStream(this.prompt);
      let fullResponse = "";

      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        if (chunkText) {
          fullResponse += chunkText;

          const now = Date.now();
          if (now - this.last_update_time > 800) {
            await this.chatClient.partialUpdateMessage(message_id, {
              set: { text: fullResponse },
            });
            this.last_update_time = now;
          }

          await this.channel.sendEvent({
            type: "ai_indicator.update",
            ai_state: "AI_STATE_GENERATING",
            cid,
            message_id,
          });
        }
      }

      // Final update
      await this.chatClient.partialUpdateMessage(message_id, {
        set: { text: fullResponse },
      });

      await this.channel.sendEvent({
        type: "ai_indicator.clear",
        cid,
        message_id,
      });
    } catch (error) {
      console.error("Gemini streaming error:", error);
      await this.handleError(error as Error);
    } finally {
      await this.dispose();
    }
  };

  dispose = async () => {
    if (this.is_done) return;
    this.is_done = true;
    this.chatClient.off("ai_indicator.stop", this.handleStopGenerating);
    this.onDispose();
  };

  private handleStopGenerating = async (event: Event) => {
    if (this.is_done || event.message_id !== this.message.id) {
      return;
    }

    console.log("Stop generating for message", this.message.id);

    await this.channel.sendEvent({
      type: "ai_indicator.clear",
      cid: this.message.cid,
      message_id: this.message.id,
    });

    await this.dispose();
  };

  private handleError = async (error: Error) => {
    if (this.is_done) return;

    await this.channel.sendEvent({
      type: "ai_indicator.update",
      ai_state: "AI_STATE_ERROR",
      cid: this.message.cid,
      message_id: this.message.id,
    });

    await this.chatClient.partialUpdateMessage(this.message.id, {
      set: {
        text: error.message ?? "Error generating the message",
      },
    });
  };
}
