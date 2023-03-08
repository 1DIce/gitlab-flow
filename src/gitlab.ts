import { Select, Toggle } from "../dependencies/cliffy.deps.ts";
import { crypto, Path } from "../dependencies/std.deps.ts";
import { getConfig } from "../src/config.ts";
import { Git } from "./git.ts";
import { GitlabApi } from "./gitlab-api.ts";
import { CreateMergeRequestRequest } from "./gitlab-api.types.ts";

const git = new Git();

const api = new GitlabApi();

function toHexString(bytes: ArrayBuffer): string {
  return new Uint8Array(bytes).reduce(
    (str, byte) => str + byte.toString(16).padStart(2, "0"),
    "",
  );
}

async function selectTargetBranch(): Promise<string | undefined> {
  const availableBranches = getConfig().defaultTargetBranches?.length
    ? getConfig().defaultTargetBranches
    : await api.fetchAllRemoteBranchNames();

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

function getAvailableReviewers(): string[] {
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

async function selectReviewer(): Promise<string> {
  const NO_SELECTION = "NO_SELECTION";
  const availableReviewers = getAvailableReviewers();
  console.debug(availableReviewers);
  const reviewer: string = await Select.prompt({
    message: `Choose a reviewer`,
    options: [...availableReviewers, { name: "None", value: NO_SELECTION }],
    search: true,
  });

  if (reviewer === NO_SELECTION) {
    return "";
  }

  const reviewerUser = await api.findUsersByName(reviewer);
  if (reviewerUser?.length > 1) {
    throw new Error("multiple user with name " + reviewer + " found!");
  }
  return reviewerUser?.[0]?.id ?? "";
}

function getDefaultLabels(): string[] {
  return getConfig().defaultLabels ?? [""];
}

async function getSquashCommitsFlag(): Promise<boolean> {
  const squashCommits: boolean = await Toggle.prompt(
    {
      message: "Squash commits when merge request is accepted?",
      default: true,
    },
  );
  return squashCommits;
}

async function getCurrentUserId() {
  const currentUser = await api.getCurrentUser();
  return currentUser?.id ?? "";
}

async function setDraft(draft: boolean, mrIid: number, oldTitle: string) {
  if (oldTitle.trim().startsWith("Draft: ") && draft === false) {
    await api.updateMergeRequest(mrIid, {
      title: oldTitle.trim().replace("Draft: ", ""),
    });
  } else if (!oldTitle.trim().startsWith("Draft: ") && draft) {
    await api.updateMergeRequest(mrIid, { title: "Draft: " + oldTitle });
  }
}

async function createMergeRequest(
  source_branch: string,
  config: { draft: boolean },
) {
  const reviewerId = await selectReviewer();
  const title = (config.draft ? "Draft: " : "") + (await git.getCommitTitle() ??
    "");
  const targetBranch = await selectTargetBranch();
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
    description: (await git.getCommitMessageBody()) ?? "",
    reviewer_ids: [reviewerId] || [],
    assignee_id: await getCurrentUserId(),
    labels: getDefaultLabels(),
    remove_source_branch: true,
    squash: await getSquashCommitsFlag(),
  };
  return await api.createMergeRequest(body);
}

async function getRemoteBranchWithoutPrefix(): Promise<string | undefined> {
  const remoteBranch = await git.getRemoteBranch();
  return remoteBranch?.replace("origin/", "");
}

async function getMergeRequestForCurrentBranch() {
  const remoteBranch = await getRemoteBranchWithoutPrefix();
  if (remoteBranch) {
    const mrs = await api.fetchOpenMergeRequestForBranch(remoteBranch);

    if (mrs?.length > 1) {
      throw new Error("Multiple merge requests found");
    }
    const mr = mrs?.[0];
    return mr;
  }
  return undefined;
}

export async function pushToMergeRequest(
  config: { draft: boolean; force: boolean },
) {
  await git.fetch();
  const localBranch = (await git.getLocalBranch()) ?? "";
  let remoteBranch = await getRemoteBranchWithoutPrefix();
  if (!remoteBranch) {
    await git.createRemoteBranch(localBranch);
    remoteBranch = localBranch;
  } else {
    // TODO force ??
  }

  const mrs = await api.fetchOpenMergeRequestForBranch(remoteBranch);

  if (mrs?.length > 1) {
    throw new Error("Multiple merge requests found");
  }
  let mr = mrs?.[0];

  if (!mr) {
    // get default labels
    await git.gitPush(config.force);
    mr = await createMergeRequest(remoteBranch, config);
  } else {
    await setDraft(config.draft, mr.iid, mr.title);
    await git.gitPush(config.force);
  }
  console.log("Merge request: " + mr.web_url);
}

async function getRemoteFileChangeUrl(filePath: string) {
  const gitRoot = await git.getGitRoot();
  if (!gitRoot) {
    throw new Error("Not inside a git repository");
  }
  const absoluteFilePath = Path.resolve(filePath);
  const gitRootParts = gitRoot.split("/");
  const relativeFilePathToGitRoot = absoluteFilePath.split("/").filter(
    (segment, index) => gitRootParts[index] !== segment,
  ).join("/");
  const mrUrl = (await getMergeRequestForCurrentBranch())?.web_url;
  const filePathHash = toHexString(crypto.subtle.digestSync(
    "SHA-1",
    new TextEncoder().encode(relativeFilePathToGitRoot),
  ));
  const changeUrl = mrUrl + "/diffs#" + filePathHash;
  return changeUrl;
}

export async function stdoutRemoteFileChangeUrl(filePath: string) {
  const changeUrl = await getRemoteFileChangeUrl(filePath);
  console.log(changeUrl);
}

export async function stdoutTargetBranch() {
  const targetBranch =
    (await getMergeRequestForCurrentBranch())?.target_branch ?? "";
  console.log(targetBranch);
}
