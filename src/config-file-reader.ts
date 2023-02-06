import { GlobalConfig } from "./config.ts";
import { Path } from "../dependencies/std.deps.ts";
import { FileSystem } from "./file-system.ts";
import { environment } from "../environment.ts";

const CONFIG_FILE_NAME = [
  `.${environment.binaryName}.json`,
  `${environment.binaryName}.json`,
  ".gitlab-mr.json",
  "gitlab-mr.json",
] as const;

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
    return CONFIG_FILE_NAME.find((validConfigName) =>
      validConfigName === fileName
    ) != null;
  }

  private getConfigHomePath(): string {
    const xdgHome = Deno.env.get("XDG_CONFIG_HOME");
    return xdgHome
      ? xdgHome + `/${environment.binaryName}`
      : Deno.env.get("HOME") + `/.config/${environment.binaryName}`;
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

    const userHomeConfigPath = this.findConfigFileInDirectory(
      this.getConfigHomePath(),
    );
    if (userHomeConfigPath) {
      return userHomeConfigPath;
    }

    // no config file found
    return undefined;
  }

  private findConfigFileInDirectory(directory: string): string | undefined {
    try {
      for (const entry of this.fs.readDirSync(directory)) {
        if (entry.isFile && this.isConfigFile(entry.name)) {
          return directory + "/" + entry.name;
        }
      }
    } catch (_) {
      return undefined;
    }
    return undefined;
  }
}
