import { Kia } from "../dependencies/kia.deps.ts";

export async function progressSpinner<T>(
  operation: Promise<T>,
  message: string,
): Promise<T> {
  const spinner = new Kia.default(message);
  spinner.start();
  const result = await operation;
  spinner.stop();
  return result;
}
