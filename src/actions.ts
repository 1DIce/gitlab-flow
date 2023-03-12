import { Select, Toggle } from "../dependencies/cliffy.deps.ts";
import { crypto, Path } from "../dependencies/std.deps.ts";
import { getConfig } from "../src/config.ts";
import { UserFriendlyException } from "./exceptions.ts";
import { ExitCode } from "./exit-code.ts";
import { Git } from "./git.ts";
import { GitlabApi } from "./gitlab-api.ts";
import { CreateMergeRequestRequest } from "./gitlab-api.types.ts";
import { Output } from "./output.ts";

export class Actions {
  constructor(
    private git: Git,
    private api: GitlabApi,
    private out: Output,
  ) {}

  private toHexString(bytes: ArrayBuffer): string {
    return new Uint8Array(bytes).reduce(
      (str, byte) => str + byte.toString(16).padStart(2, "0"),
      "",
    );
  }

  private async selectTargetBranch(): Promise<string | undefined> {
    const availableBranches = getConfig().defaultTargetBranches?.length
      ? getConfig().defaultTargetBranches
      : await this.api.fetchAllRemoteBranchNames();

    if (availableBranches != null && availableBranches.length > 0) {
      const targetBranch: string = await Select.prompt({
        message: `Choose a target branch`,
        options: availableBranches,
        search: true,
      });
      return targetBranch;
    } else {
      return undefined;
    }
  }

  private getAvailableReviewers(): string[] {
    const availableReviewers = getConfig().reviewers ?? [];

    if (
      !Array.isArray(availableReviewers) ||
      availableReviewers.some((reviewer) => !(typeof reviewer === "string"))
    ) {
      throw new Error(
        "List of reviewers from configuration file is not valid: " +
          JSON.stringify(availableReviewers),
      );
    }
    return availableReviewers;
  }

  private async selectReviewer(): Promise<string> {
    const NO_SELECTION = "NO_SELECTION";
    const availableReviewers = this.getAvailableReviewers();
    console.debug(availableReviewers);
    const reviewer: string = await Select.prompt({
      message: `Choose a reviewer`,
      options: [...availableReviewers, { name: "None", value: NO_SELECTION }],
      search: true,
    });

    if (reviewer === NO_SELECTION) {
      return "";
    }

    const reviewerUser = await this.api.findUsersByName(reviewer);
    if (reviewerUser?.length > 1) {
      throw new Error("multiple user with name " + reviewer + " found!");
    }
    return reviewerUser?.[0]?.id ?? "";
  }

  private getDefaultLabels(): string[] {
    return getConfig().defaultLabels ?? [""];
  }

  private async getSquashCommitsFlag(): Promise<boolean> {
    const squashCommits: boolean = await Toggle.prompt(
      {
        message: "Squash commits when merge request is accepted?",
        default: true,
      },
    );
    return squashCommits;
  }

  private async getCurrentUserId() {
    const currentUser = await this.api.getCurrentUser();
    return currentUser?.id ?? "";
  }

  private async setDraft(draft: boolean, mrIid: number, oldTitle: string) {
    if (oldTitle.trim().startsWith("Draft: ") && draft === false) {
      await this.api.updateMergeRequest(mrIid, {
        title: oldTitle.trim().replace("Draft: ", ""),
      });
    } else if (!oldTitle.trim().startsWith("Draft: ") && draft) {
      await this.api.updateMergeRequest(mrIid, { title: "Draft: " + oldTitle });
    }
  }

  public async createMergeRequest(
    source_branch: string,
    config: { draft: boolean },
  ) {
    const reviewerId = await this.selectReviewer();
    const title = (config.draft ? "Draft: " : "") +
      (await this.git.getCommitTitle() ??
        "");
    const targetBranch = await this.selectTargetBranch();
    if (!targetBranch) {
      throw new Error(
        "No target branch was selected. It is not possible to create a merge" +
          "request without a target branch",
      );
    }

    const body: CreateMergeRequestRequest = {
      source_branch,
      target_branch: targetBranch,
      title,
      description: (await this.git.getCommitMessageBody()) ?? "",
      reviewer_ids: [reviewerId] || [],
      assignee_id: await this.getCurrentUserId(),
      labels: this.getDefaultLabels(),
      remove_source_branch: true,
      squash: await this.getSquashCommitsFlag(),
    };
    return await this.api.createMergeRequest(body);
  }

  private async getRemoteBranchWithoutPrefix(): Promise<string | undefined> {
    const remoteBranch = await this.git.getRemoteBranch();
    return remoteBranch?.replace("origin/", "");
  }

  private async getMergeRequestForCurrentBranch() {
    const remoteBranch = await this.getRemoteBranchWithoutPrefix();
    if (remoteBranch) {
      const mrs = await this.api.fetchOpenMergeRequestForBranch(remoteBranch);

      if (mrs?.length > 1) {
        throw new UserFriendlyException(
          "Multiple open merge requests found for the current remote branch",
        );
      }
      const mr = mrs?.[0];
      return mr;
    }
    return undefined;
  }

  public async pushToMergeRequest(
    config: { draft: boolean; force: boolean },
  ) {
    await this.git.fetch();
    const localBranch = (await this.git.getLocalBranch()) ?? "";
    let remoteBranch = await this.getRemoteBranchWithoutPrefix();
    if (!remoteBranch) {
      await this.git.createRemoteBranch(localBranch);
      remoteBranch = localBranch;
    } else {
      // TODO force ??
    }

    const mrs = await this.api.fetchOpenMergeRequestForBranch(remoteBranch);

    if (mrs?.length > 1) {
      throw new Error("Multiple merge requests found");
    }
    let mr = mrs?.[0];

    if (!mr) {
      // get default labels
      await this.git.gitPush(config.force);
      mr = await this.createMergeRequest(remoteBranch, config);
    } else {
      await this.setDraft(config.draft, mr.iid, mr.title);
      await this.git.gitPush(config.force);
    }
    this.out.println("Merge request: " + mr.web_url);
  }

  public async getRemoteFileChangeUrl(filePath: string) {
    const gitRoot = await this.git.getGitRoot();
    if (!gitRoot) {
      throw new Error("Not inside a git repository");
    }
    const absoluteFilePath = Path.resolve(filePath);
    const gitRootParts = gitRoot.split("/");
    const relativeFilePathToGitRoot = absoluteFilePath.split("/").filter(
      (segment, index) => gitRootParts[index] !== segment,
    ).join("/");
    const mrUrl = (await this.getMergeRequestForCurrentBranch())?.web_url;
    const filePathHash = this.toHexString(crypto.subtle.digestSync(
      "SHA-1",
      new TextEncoder().encode(relativeFilePathToGitRoot),
    ));
    const changeUrl = mrUrl + "/diffs#" + filePathHash;
    return changeUrl;
  }

  public async stdoutRemoteFileChangeUrl(filePath: string) {
    const changeUrl = await this.getRemoteFileChangeUrl(filePath);
    this.out.println(changeUrl);
  }

  public async stdoutTargetBranch(): Promise<ExitCode> {
    try {
      const targetBranch =
        (await this.getMergeRequestForCurrentBranch())?.target_branch ?? "";
      if (targetBranch.trim()) {
        this.out.println(targetBranch);
      }
      return ExitCode.SUCCESS;
    } catch (e) {
      this.out.exception(e);
      return ExitCode.FAILIURE;
    }
  }
}
