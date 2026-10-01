export interface ChatOnceResult {
  reply: string;
  conversationId: string;
  provider: string;
  pendingActions: any[];
  toolsUsed: string[];
}
