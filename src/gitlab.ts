import { Select, Toggle } from "../dependencies/cliffy.deps.ts";
import { crypto, Path } from "../dependencies/std.deps.ts";
import { getConfig } from "../src/config.ts";
import { cmd } from "./cmd.ts";
import { Git } from "./git.ts";

const git = new Git();

function getAccessToken(): string {
  return getConfig().gitlabApiToken ?? Deno.env.get("GITLAB_API_TOKEN") ?? "";
}

function toHexString(bytes: ArrayBuffer): string {
  return new Uint8Array(bytes).reduce(
    (str, byte) => str + byte.toString(16).padStart(2, "0"),
    "",
  );
}

async function projectApiRequest(url: string, config?: RequestInit) {
  const jsonResponse = await fetch(
    new Request(
      getConfig().remoteBaseUrl + "/api/v4/" + "projects/" +
        getConfig().projectId + url,
      {
        headers: {
          Authorization: "Bearer " + getAccessToken(),
          "Content-Type": "application/json",
        },
        method: "GET",
        ...config,
      },
    ),
  );
  const jsonData = await jsonResponse.json();
  return jsonData;
}

async function apiRequest(url: string, config?: RequestInit) {
  const jsonResponse = await fetch(
    new Request(getConfig().remoteBaseUrl + "/api/v4/" + url, {
      headers: { Authorization: "Bearer " + getAccessToken() },
      method: "GET",
      ...(config ?? {}),
    }),
  );
  const jsonData = await jsonResponse.json();
  return jsonData;
}

function fetchOpenMergeRequestForBranch(branchName: string): Promise<any[]> {
  return projectApiRequest(
    "/merge_requests?state=opened&source_branch=" + branchName,
  );
}

async function fetchProjectLabels(): Promise<string[]> {
  const labels = await projectApiRequest("/labels") ?? [];
  return labels.map((label: { name: string }) => label.name);
}

async function fetchAllRemoteBranchNames(): Promise<string[]> {
  const branches = await projectApiRequest("/repository/branches") ?? [];
  return branches.map((branch: { name: string }) => branch.name.trim());
}

async function selectTargetBranch(): Promise<string | undefined> {
  const availableBranches = getConfig().defaultTargetBranches?.length
    ? getConfig().defaultTargetBranches
    : await fetchAllRemoteBranchNames();

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

  const reviewerUser = await apiRequest("users?username=" + reviewer);
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
  const currentUser = await apiRequest("user");
  return (currentUser?.id as string) ?? "";
}

interface UpdateMrBody {
  title?: string;
}

async function updateMergeRequest(mrIid: number, body: UpdateMrBody) {
  const response = await projectApiRequest("/merge_requests/" + mrIid, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  return response;
}

async function setDraft(draft: boolean, mrIid: number, oldTitle: string) {
  if (oldTitle.trim().startsWith("Draft: ") && draft === false) {
    await updateMergeRequest(mrIid, {
      title: oldTitle.trim().replace("Draft: ", ""),
    });
  } else if (!oldTitle.trim().startsWith("Draft: ") && draft) {
    await updateMergeRequest(mrIid, { title: "Draft: " + oldTitle });
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
  const response = await projectApiRequest("/merge_requests", {
    method: "POST",
    body: JSON.stringify({
      source_branch,
      target_branch: targetBranch,
      title,
      description: (await git.getCommitMessageBody()) ?? "",
      reviewer_ids: [reviewerId] || [],
      assignee_id: await getCurrentUserId(),
      labels: getDefaultLabels(),
      remove_source_branch: true,
      squash: await getSquashCommitsFlag(),
    }),
  });
  return response;
}

async function getMergeRequestForCurrentBranch() {
  const remoteBranch = await git.getRemoteBranch();
  if (remoteBranch) {
    const mrs = await fetchOpenMergeRequestForBranch(remoteBranch);

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
  await cmd(["git", "fetch"]);
  const localBranch = (await git.getLocalBranch()) ?? "";
  let remoteBranch = await git.getRemoteBranch();
  if (!remoteBranch) {
    await git.createRemoteBranch(localBranch);
    remoteBranch = localBranch;
  } else {
    // TODO force ??
  }

  const mrs = await fetchOpenMergeRequestForBranch(remoteBranch);

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
