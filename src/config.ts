let GLOBAL_CONFIG: GlobalConfig = {
  remoteBaseUrl: "",
  projectId: "",
};

export function getConfig(): GlobalConfig {
  return GLOBAL_CONFIG;
}

export function replaceConfig(newConfig: GlobalConfig): void {
  GLOBAL_CONFIG = newConfig;
}

export interface GlobalConfig {
  readonly remoteBaseUrl: string;
  readonly projectId: string;
  readonly gitlabApiToken?: string;
  readonly reviewers?: string[];
  readonly defaultTargetBranches?: string[];
  readonly defaultLabels?: string[];
}
