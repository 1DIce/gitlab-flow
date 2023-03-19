import { UserFriendlyException } from "./exceptions.ts";

export class Output {
  constructor(private debugActive = false) {
  }

  println(line: string): void {
    console.log(line);
  }

  debug(...value: any[]): void {
    if (this.debugActive) {
      console.debug(...value);
    }
  }

  errorln(line: string): void {
    console.error(line);
  }

  exception(exception: any) {
    if (exception instanceof UserFriendlyException) {
      this.errorln(exception.getReadableMessage());
    } else if (exception instanceof Error) {
      console.error(exception);
    }
  }
}
