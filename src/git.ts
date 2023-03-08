import { cmd, CmdResult } from "./cmd.ts";

export class Git {
  async getGitRoot() {
    const resp = await cmd(["git", "rev-parse", "--show-toplevel"]);
    return resp.success ? resp.stdout.trim() : undefined;
  }

  async getRemoteBranch(): Promise<string | undefined | void> {
    const result = await cmd([
      "git",
      "rev-parse",
      "--symbolic-full-name",
      "--abbrev-ref",
      "HEAD@{u}",
    ]);
    return result.success
      ? result.stdout.replace("origin/", "").trim()
      : undefined;
  }

  async getLocalBranch(): Promise<string | undefined | void> {
    const result = await cmd([
      "git",
      "rev-parse",
      "--symbolic-full-name",
      "--abbrev-ref",
      "HEAD",
    ]);
    return result.success ? result.stdout.trim() : undefined;
  }

  async getCommitTitle(): Promise<string | void> {
    const result = await cmd([
      "git",
      "show",
      "--pretty=format:%s",
      "-s",
      "HEAD",
    ]);
    return (result.success ? result.stdout.trim() : "");
  }

  async getCommitMessageBody(): Promise<string | void> {
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

  gitPush(force: boolean) {
    return cmd(force ? ["git", "push"] : ["git", "push", "--force"]);
  }
}
