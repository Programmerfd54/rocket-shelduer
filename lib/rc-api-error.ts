export class RocketChatApiError extends Error {
  constructor(message: string, public status: number, public endpoint: string, public code?: string) {
    super(message);
    this.name = 'RocketChatApiError';
  }
}
