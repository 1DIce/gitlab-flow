import { cmd, CmdResult } from "./cmd.ts";

export class Git {
  fetch(): Promise<CmdResult> {
    return cmd(["git", "fetch"]);
  }

  async getGitRoot(): Promise<string | undefined> {
    const resp = await cmd(["git", "rev-parse", "--show-toplevel"]);
    return resp.success ? resp.stdout.trim() : undefined;
  }

  async getRemoteBranch(): Promise<string | undefined> {
    const result = await cmd([
      "git",
      "rev-parse",
      "--symbolic-full-name",
      "--abbrev-ref",
      "HEAD@{u}",
    ]);
    return result.success ? result.stdout.trim() : undefined;
  }

  async getLocalBranch(): Promise<string | undefined> {
    const result = await cmd([
      "git",
      "rev-parse",
      "--symbolic-full-name",
      "--abbrev-ref",
      "HEAD",
    ]);
    return result.success ? result.stdout.trim() : undefined;
  }

  async getCommitTitle(): Promise<string> {
    const result = await cmd([
      "git",
      "show",
      "--pretty=format:%s",
      "-s",
      "HEAD",
    ]);
    return (result.success ? result.stdout.trim() : "");
  }

  async getCommitMessageBody(): Promise<string> {
    const result = await cmd([
      "git",
      "show",
      "--pretty=format:%b",
      "-s",
      "HEAD",
    ]);
    return (result.success ? result.stdout : "");
  }

  createRemoteBranch(branchName: string): Promise<CmdResult> {
    return cmd([
      "git",
      "push",
      "--set-upstream",
      "origin",
      branchName,
    ]);
  }

  async hasUnpushedCommits(): Promise<boolean> {
    const result = await cmd([
      "git",
      "diff",
      "--exit-code",
      "HEAD..FETCH_HEAD",
    ]);
    return !result.success;
  }

  gitPush(force: boolean): Promise<CmdResult> {
    return cmd(force ? ["git", "push"] : ["git", "push", "--force"]);
  }
}
