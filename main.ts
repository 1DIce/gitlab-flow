#! /usr/bin/env -S deno run --allow-run --allow-env --allow-net --allow-read --unstable --no-check
import { Select } from "https://deno.land/x/cliffy@v0.20.1/prompt/mod.ts";
import { Command } from "https://deno.land/x/cliffy@v0.20.1/command/mod.ts";

interface ConfigFile {
  remoteBaseUrl: string;
  projectId: string;
}

let GLOBAL_CONFIG: ConfigFile = {
  remoteBaseUrl: "",
  projectId: "",
};

function getAccessToken(): string {
  return Deno.env.get("GITLAB_API_TOKEN") ?? "";
}

function getConfigHome(): string {
  const xdgHome = Deno.env.get("XDG_CONFIG_HOME");
  return xdgHome
    ? xdgHome + "/gitlab-cli"
    : Deno.env.get("HOME") + "/.config/gitlab-cli";
}

function loadConfigFile(): void {
  const path = getConfigHome() + "/gitlab-cli.json";
  try {
    const loaded = JSON.parse(Deno.readTextFileSync(path));
    GLOBAL_CONFIG = { ...GLOBAL_CONFIG, ...loaded };
  } catch (e) {
    throw new Error("Failed to load config file: " + path, e);
  }
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

function getRemoteBranch(): Promise<string | undefined | void> {
  return runExternalCmd([
    "git",
    "rev-parse",
    "--symbolic-full-name",
    "--abbrev-ref",
    "HEAD@{u}",
  ]).then((result) => {
    return result.success
      ? result.stdout.replace("origin/", "").trim()
      : undefined;
  });
}

function getLocalBranch(): Promise<string | undefined | void> {
  return runExternalCmd([
    "git",
    "rev-parse",
    "--symbolic-full-name",
    "--abbrev-ref",
    "HEAD",
  ]).then((result) => {
    return result.success ? result.stdout.trim() : undefined;
  });
}

function getCommitTitle(): Promise<string | void> {
  return runExternalCmd([
    "git",
    "show",
    "--pretty=format:%s",
    "-s",
    "HEAD",
  ]).then((result) => (result.success ? result.stdout.trim() : ""));
}

function getCommitMessageBody(): Promise<string | void> {
  return runExternalCmd([
    "git",
    "show",
    "--pretty=format:%b",
    "-s",
    "HEAD",
  ]).then((result) => (result.success ? result.stdout : ""));
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
  return labels.map((label: any) => label?.name).filter(
    (label: string) => !!label,
  ) as string[] ?? [];
}

async function selectTargetBranch() {
  const availableBranches = ["master", "lts/10.10", "lts/10.0"];
  const targetBranch: string = await Select.prompt({
    message: `Choose a target branch`,
    options: availableBranches,
    search: true,
  });
  return targetBranch;
}

async function selectReviewer(): Promise<string> {
  let availableReviewers: string[] = [];
  try {
    Deno.readTextFileSync(
      getConfigHome() + "/reviewers.txt",
    )
      .split("\n")
      .map((name) => name.trim());
  } catch (e) {
    availableReviewers = [];
  }

  const NO_SELECTION = "NO_SELECTION";
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
    throw new Error("mutiple user with name " + reviewer + " found!");
  }
  return reviewerUser?.[0]?.id ?? "";
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
  //TODO set default labels
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
      labels: [""],
      remove_source_branch: true,
      squash: true, // TODO select
    }),
  });
  return response;
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
}

/****************************/
/*          MAIN            */
/****************************/
async function main() {
  loadConfigFile();

  await new Command()
    .name("gitlab-cli")
    .version("0.1.0")
    .description("Command line interface for gitlab")
    .option(
      "-f, --force",
      "Use force push",
      { global: true },
    )
    .command(
      "publish",
      new Command().action((parmas) =>
        pushToMergeRequest({ draft: false, force: parmas.force })
      ),
    )
    .command(
      "draft",
      new Command().action((params) =>
        pushToMergeRequest({ draft: true, force: params.force })
      ),
    )
    .parse(Deno.args);
}

main();
