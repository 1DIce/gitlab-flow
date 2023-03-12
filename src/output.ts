import { UserFriendlyException } from "./exceptions.ts";

export class Output {
  println(line: string): void {
    console.log(line);
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
