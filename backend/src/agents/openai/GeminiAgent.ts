import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Channel, DefaultGenerics, Event, StreamChat } from "stream-chat";
import type { AIAgent } from "../types";
import { GeminiResponseHandler } from "./GeminiResponseHandler"; // 👈 new handler

export class GeminiAgent implements AIAgent {
  private genAI?: GoogleGenerativeAI;
  private lastInteractionTs = Date.now();

  constructor(
    readonly chatClient: StreamChat,
    readonly channel: Channel
  ) {}

  dispose = async () => {
    this.chatClient.off("message.new", this.handleMessage);
    await this.chatClient.disconnectUser();
  };

  get user() {
    return this.chatClient.user;
  }

  getLastInteraction = (): number => this.lastInteractionTs;

  init = async () => {
    const apiKey = process.env.GEMINI_API_KEY as string | undefined;
    if (!apiKey) {
      throw new Error("Gemini API key is required");
    }

    this.genAI = new GoogleGenerativeAI(apiKey);
    this.chatClient.on("message.new", this.handleMessage);
  };

  private getWritingAssistantPrompt = (context?: string): string => {
    const currentDate = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    return `You are an expert AI Writing Assistant. Today’s date is ${currentDate}.  
Your job: collaborate with the user on writing tasks.  

Capabilities:  
- Content creation, style improvement, brainstorming.  
- Writing coaching.  

Context: ${context || "General writing assistance."}`;
  };

  private handleMessage = async (e: Event<DefaultGenerics>) => {
    if (!this.genAI) {
      console.log("Gemini not initialized");
      return;
    }

    if (!e.message || e.message.ai_generated) {
      return;
    }

    const message = e.message.text;
    if (!message) return;

    this.lastInteractionTs = Date.now();

    const writingTask = (e.message.custom as { writingTask?: string })
      ?.writingTask;
    const context = writingTask ? `Writing Task: ${writingTask}` : undefined;
    const instructions = this.getWritingAssistantPrompt(context);

    // Create placeholder chat message
    const { message: channelMessage } = await this.channel.sendMessage({
      text: "",
      ai_generated: true,
    });

    await this.channel.sendEvent({
      type: "ai_indicator.update",
      ai_state: "AI_STATE_THINKING",
      cid: channelMessage.cid,
      message_id: channelMessage.id,
    });

    // 👇 Hand off streaming to GeminiResponseHandler
    const responseHandler = new GeminiResponseHandler(
      this.genAI,
      this.chatClient,
      this.channel,
      channelMessage,
      `${instructions}\n\nUser: ${message}`,
      () => console.log("Gemini handler disposed")
    );

    responseHandler.run();
  };
}
