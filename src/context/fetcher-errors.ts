export class FetchFailureError extends Error {
  readonly userMessage: string;
  constructor(message: string) {
    super(message);
    this.name = "FetchFailureError";
    this.userMessage = message;
  }
}
