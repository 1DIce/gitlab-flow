import { GlobalConfig } from "./config.ts";
import { Path } from "../dependencies/std.deps.ts";
import { FileSystem } from "./file-system.ts";

export class ConfigFileReader {
  constructor(private readonly fs: FileSystem) {}

  public loadConfigFile(): GlobalConfig | undefined {
    const path = this.findConfigFilePath();
    if (path) {
      try {
        const loadedConfig = JSON.parse(this.fs.readTextFileSync(path));
        return loadedConfig;
      } catch (e) {
        throw new Error("Failed to load config file: " + path, e);
      }
    }
    return undefined;
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

  private findConfigFilePath(): string | undefined {
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

    const userHomeConfigPath = this.getConfigHomePath() + "/gitlab-cli.json";
    if (this.fs.isFileSync(userHomeConfigPath)) {
      return userHomeConfigPath;
    }

    // no config file found
    return undefined;
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
