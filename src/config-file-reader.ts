import { GlobalConfig } from "./config.ts";
import { Path } from "../dependencies/std.deps.ts";
import { FileSystem } from "./file-system.ts";

export class ConfigFileReader {
  constructor(private readonly fs: FileSystem) {}

  public loadConfigFile(): GlobalConfig {
    const path = this.findConfigFilePath();
    try {
      const loadedConfig = JSON.parse(this.fs.readTextFileSync(path));
      return loadedConfig;
    } catch (e) {
      throw new Error("Failed to load config file: " + path, e);
    }
  }

  private isConfigFile(fileName: string): boolean {
    return fileName === ".gitlab-cli.json";
  }

  private getConfigHomePath(): string {
    const xdgHome = Deno.env.get("XDG_CONFIG_HOME");
    return xdgHome
      ? xdgHome + "/gitlab-cli"
      : Deno.env.get("HOME") + "/.config/gitlab-cli";
  }

  private isRootDirectory(path: string): boolean {
    return path === "/";
  }

  private findConfigFilePath(): string {
    let currentSearchDirectory = Path.resolve(".");

    while (currentSearchDirectory) {
      const configFilePath = this.findConfigFileInDirectory(
        currentSearchDirectory,
      );
      if (configFilePath) {
        return configFilePath;
      }
      if (this.isRootDirectory(currentSearchDirectory)) {
        break;
      }
      currentSearchDirectory = Path.dirname(currentSearchDirectory);
    }

    return this.getConfigHomePath() + "/gitlab-cli.json";
  }

  private findConfigFileInDirectory(directory: string): string {
    for (const entry of this.fs.readDirSync(directory)) {
      if (entry.isFile && this.isConfigFile(entry.name)) {
        return directory + "/" + entry.name;
      }
    }
    return "";
  }
}
