#! /usr/bin/env -S deno run --allow-run --allow-env --allow-net --allow-read --no-check

import { Command, Select, Toggle } from "./dependencies/cliffy.deps.ts";
import { crypto, Path } from "./dependencies/std.deps.ts";
import { ConfigFileReader } from "./src/config-file-reader.ts";
import { GlobalConfig } from "./src/config.ts";
import { FileSystem } from "./src/file-system.ts";

let GLOBAL_CONFIG: GlobalConfig = {
  remoteBaseUrl: "",
  projectId: "",
};

const fs = new FileSystem();

function getAccessToken(): string {
  return GLOBAL_CONFIG.gitlabApiToken ?? Deno.env.get("GITLAB_API_TOKEN") ?? "";
}

function toHexString(bytes: ArrayBuffer): string {
  return new Uint8Array(bytes).reduce(
    (str, byte) => str + byte.toString(16).padStart(2, "0"),
    "",
  );
}

async function runExternalCmd(
  cmd: string[],
): Promise<{ stdout: string; success: boolean; stdError: string }> {
  // create subprocess
  const p = Deno.run({
    cmd,
    stdout: "piped",
    stderr: "piped",
  });

  // Reading the outputs closes their pipes
  const [status, rawOutput, rawError] = await Promise.all([
    p.status(),
    p.output(),
    p.stderrOutput(),
  ]);

  if (status.code === 0) {
    const output = new TextDecoder().decode(rawOutput); // since it's returned as UInt8Array
    return Promise.resolve({
      stdout: output,
      success: true,
      stdError: "",
    });
  } else {
    const errorString = new TextDecoder().decode(rawError);
    console.warn("Caught error during api request", errorString);
    return {
      stdout: "",
      success: false,
      stdError: errorString,
    };
  }
}

async function getGitRoot() {
  const resp = await runExternalCmd(["git", "rev-parse", "--show-toplevel"]);
  return resp.success ? resp.stdout.trim() : undefined;
}
async function getRemoteBranch(): Promise<string | undefined | void> {
  const result = await runExternalCmd([
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

async function getLocalBranch(): Promise<string | undefined | void> {
  const result = await runExternalCmd([
    "git",
    "rev-parse",
    "--symbolic-full-name",
    "--abbrev-ref",
    "HEAD",
  ]);
  return result.success ? result.stdout.trim() : undefined;
}

async function getCommitTitle(): Promise<string | void> {
  const result = await runExternalCmd([
    "git",
    "show",
    "--pretty=format:%s",
    "-s",
    "HEAD",
  ]);
  return (result.success ? result.stdout.trim() : "");
}

async function getCommitMessageBody(): Promise<string | void> {
  const result = await runExternalCmd([
    "git",
    "show",
    "--pretty=format:%b",
    "-s",
    "HEAD",
  ]);
  return (result.success ? result.stdout : "");
}

function createRemoteBranch(branchName: string) {
  return runExternalCmd([
    "git",
    "push",
    "--set-upstream",
    "origin",
    branchName,
  ]);
}

function gitPush(force: boolean) {
  return runExternalCmd(force ? ["git", "push"] : ["git", "push", "--force"]);
}

async function projectApiRequest(url: string, config?: RequestInit) {
  const jsonResponse = await fetch(
    new Request(
      GLOBAL_CONFIG.remoteBaseUrl + "/api/v4/" + "projects/" +
        GLOBAL_CONFIG.projectId + url,
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
    new Request(GLOBAL_CONFIG.remoteBaseUrl + "/api/v4/" + url, {
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

async function selectTargetBranch() {
  const availableBranches = GLOBAL_CONFIG.defaultTargetBranches?.length
    ? GLOBAL_CONFIG.defaultTargetBranches
    : await fetchAllRemoteBranchNames();

  const targetBranch: string = await Select.prompt({
    message: `Choose a target branch`,
    options: availableBranches,
    search: true,
  });
  return targetBranch;
}

function getAvailableReviewers(): string[] {
  const availableReviewers = GLOBAL_CONFIG.reviewers ?? [];

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
  return GLOBAL_CONFIG.defaultLabels ?? [""];
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
  const title = (config.draft ? "Draft: " : "") + (await getCommitTitle() ??
    "");
  const response = await projectApiRequest("/merge_requests", {
    method: "POST",
    body: JSON.stringify({
      source_branch,
      target_branch: await selectTargetBranch(),
      title,
      description: (await getCommitMessageBody()) ?? "",
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
  const remoteBranch = await getRemoteBranch();
  if (remoteBranch) {
    const mrs = await fetchOpenMergeRequestForBranch(remoteBranch);

    if (mrs?.length > 1) {
      throw new Error("Multiple merge requests found");
    }
    let mr = mrs?.[0];
    return mr;
  }
  return undefined;
}

async function pushToMergeRequest(config: { draft: boolean; force: boolean }) {
  await runExternalCmd(["git", "fetch"]);
  const localBranch = (await getLocalBranch()) ?? "";
  let remoteBranch = await getRemoteBranch();
  if (!remoteBranch) {
    await createRemoteBranch(localBranch);
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
    await gitPush(config.force);
    mr = await createMergeRequest(remoteBranch, config);
  } else {
    await setDraft(config.draft, mr.iid, mr.title);
    await gitPush(config.force);
  }
  console.log("Merge request: " + mr.web_url);
}

async function getRemoteFileChangeUrl(filePath: string) {
  const gitRoot = await getGitRoot();
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

async function stdoutRemoteFileChangeUrl(filePath: string) {
  const changeUrl = await getRemoteFileChangeUrl(filePath);
  console.log(changeUrl);
}

async function stdoutTargetBranch() {
  const targetBranch =
    (await getMergeRequestForCurrentBranch())?.target_branch ?? "";
  console.log(targetBranch);
}

/****************************/
/*          MAIN            */
/****************************/
async function main() {
  GLOBAL_CONFIG = new ConfigFileReader(fs).loadConfigFile();

  await new Command()
    .name("gitlab-cli")
    .version("0.1.0")
    .description("Command line interface for gitlab")
    .env(
      "GITLAB_API_TOKEN=<value:string>",
      "Gitlab api token that is used to communicate with the API",
    )
    .option(
      "-f, --force",
      "Use force push",
      { global: true },
    )
    .command(
      "publish",
      new Command().description(
        "Uploads new changes to merge request. " +
          "A remote branch is created if it does not exist. " +
          "A merge request is created if it does not exist. " +
          "The merge request is marked as ready if it was a draft",
      ).action((params) =>
        pushToMergeRequest({ draft: false, force: params.force })
      ),
    )
    .command(
      "draft",
      new Command().description(
        "Uploads new changes to merge request. " +
          "A remote branch is created if it does not exist. " +
          "A merge request is created if it does not exist. " +
          "The merge request is marked as a draft",
      ).action((params) =>
        pushToMergeRequest({ draft: true, force: params.force })
      ),
    ).command(
      "file-change <file_path:string>",
      new Command().description(
        "Get url to change of the provided file in the open merge request",
      ).action((params, filePath) => stdoutRemoteFileChangeUrl(filePath)),
    ).command(
      "target",
      new Command().description(
        "Get merge request target branch",
      ).action((params) => stdoutTargetBranch()),
    )
    .parse(Deno.args);
}

main();
