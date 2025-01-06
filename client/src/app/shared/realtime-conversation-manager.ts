// TypeScript implementation of RealtimeConversationManager

interface RealtimeConversationSession {
    configureSession(options: any): Promise<void>;
    startConversation(): Promise<RealtimeConversationSession>;
    receiveUpdates(): Promise<any[]>; // Changed to Promise<any[]> to align with TypeScript/JavaScript best practices
    sendInputAudio(micStream: any): Promise<void>;
    addItem(item: any): Promise<void>;
    dispose(): void;
  }
  
  interface Speaker {
    clearPlayback(): Promise<void>;
    enqueue(audioBytes: Uint8Array | undefined): Promise<void>;
  }
  
  class RealtimeConversationManager<TModel> {
    private session: RealtimeConversationSession | null = null;
    private prevModelJson: string | null = null;
  
    constructor(
      private modelDescription: string,
      private realtimeConversationClient: { startConversation: () => Promise<RealtimeConversationSession> },
      private micStream: any,
      private speaker: Speaker,
      private updateCallback: (model: TModel) => void,
      private addMessage: (message: string) => void
    ) {}
  
    async run(): Promise<void> {
      const jsonSchema = JSON.stringify({
        type: "object",
        properties: {},
      }); // Simplified schema example
  
      const sessionOptions = {
        instructions: `You are helping to edit a JSON object that represents a ${this.modelDescription}.
  This JSON object conforms to the following schema: ${jsonSchema}`,
        voice: "Alloy",
        contentModalities: "Text",
        turnDetectionOptions: {
          detectionThreshold: 0.4,
          silenceDuration: 150,
        },
        tools: [],
      };
  
      this.addMessage("Connecting...");
      this.session = await this.realtimeConversationClient.startConversation();
      await this.session.configureSession(sessionOptions);
      const outputStringBuilder: string[] = [];
  
      const updates = await this.session.receiveUpdates();
      for (const update of updates) {
        switch (update.type) {
          case "ConversationSessionStarted":
            this.addMessage("Connected");
            await this.session.sendInputAudio(this.micStream);
            break;
          case "ConversationInputSpeechStarted":
            this.addMessage("Speech started");
            await this.speaker.clearPlayback();
            break;
          case "ConversationInputSpeechFinished":
            this.addMessage("Speech finished");
            break;
          case "ConversationItemStreamingPartDelta":
            await this.speaker.enqueue(update.audioBytes);
            outputStringBuilder.push(update.text || "");
            break;
          case "ConversationResponseFinished":
            this.addMessage(outputStringBuilder.join(""));
            outputStringBuilder.length = 0;
            break;
        }
      }
    }
  
    async setModelData(modelData: TModel): Promise<void> {
      if (this.session) {
        const newJson = JSON.stringify(modelData);
        if (newJson !== this.prevModelJson) {
          this.prevModelJson = newJson;
          await this.session.addItem({
            message: `The current modelData value is ${newJson}. When updating this later, include all these same values if they are unchanged.`,
          });
        }
      }
    }
  
    dispose(): void {
      this.session?.dispose();
    }
  }
  