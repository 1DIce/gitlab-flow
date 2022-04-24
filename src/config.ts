export interface GlobalConfig {
  readonly remoteBaseUrl: string;
  readonly projectId: string;
  readonly gitlabApiToken?: string;
  readonly reviewers?: string[];
  readonly defaultTargetBranches?: string[];
  readonly defaultLabels?: string[];
}

