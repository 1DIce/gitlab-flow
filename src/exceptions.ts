export class UserFriendlyException extends Error {
  constructor(private userMessage: string) {
    super(userMessage);
  }

  getReadableMessage() {
    return this.userMessage;
  }
}
