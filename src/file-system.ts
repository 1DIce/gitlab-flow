export class FileSystem {
  constructor() {}

  readDirSync(path: string | URL) {
    return Deno.readDirSync(path);
  }

  readTextFileSync(path: string | URL) {
    return Deno.readTextFileSync(path);
  }

  isFileSync(path: string | URL): boolean {
    return Deno.statSync(path).isFile;
  }
}
