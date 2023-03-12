import { Actions } from "../actions.ts";
import { GitlabApi } from "../gitlab-api.ts";
import { Git } from "../git.ts";
import {
  assertSpyCall,
  assertSpyCalls,
  beforeEach,
  describe,
  it,
  Spy,
  spy,
  stub,
} from "../../dependencies/test.deps.ts";
import { MergeRequestResponse } from "../gitlab-api.types.ts";
import { Output } from "../output.ts";

describe("stdoutTargetBranch", () => {
  let git: Git;
  let api: GitlabApi;
  let out: Output;
  let stdoutSpy: Spy;
  let errorSpy: Spy;

  beforeEach(() => {
    git = new Git();
    api = new GitlabApi();
    out = new Output();
    stdoutSpy = spy(out, "println");
    errorSpy = spy(out, "errorln");
  });

  it("should print current merge request target branch", async () => {
    stub(git, "getRemoteBranch", () => Promise.resolve("origin/my-branch"));

    stub(
      api,
      "fetchOpenMergeRequestForBranch",
      (branchName) => {
        const mockResponse: MergeRequestResponse = {
          iid: 11,
          title: "my mr",
          target_branch: "master",
          source_branch: branchName,
          web_url: "localhost",
        };
        return Promise.resolve([mockResponse]);
      },
    );
    const actions = new Actions(git, api, out);

    await actions.stdoutTargetBranch();

    assertSpyCall(stdoutSpy, 0, { args: ["master"] });
  });

  it("should print nothing if no merge request exist for the local branch", async () => {
    stub(git, "getRemoteBranch", () => Promise.resolve("origin/my-branch"));

    stub(
      api,
      "fetchOpenMergeRequestForBranch",
      (_branchName) => {
        return Promise.resolve([]);
      },
    );
    const actions = new Actions(git, api, out);

    await actions.stdoutTargetBranch();

    assertSpyCalls(stdoutSpy, 0);
    assertSpyCalls(errorSpy, 0);
  });

  it("should print to stderror if multiple open merge requests exists", async () => {
    stub(git, "getRemoteBranch", () => Promise.resolve("origin/my-branch"));

    stub(
      api,
      "fetchOpenMergeRequestForBranch",
      (branchName) => {
        const mockResponse: MergeRequestResponse = {
          iid: 11,
          title: "my mr",
          target_branch: "master",
          source_branch: branchName,
          web_url: "localhost",
        };
        const mockResponse2 = {
          ...mockResponse,
          iid: 12,
        };
        return Promise.resolve([mockResponse, mockResponse2]);
      },
    );
    const actions = new Actions(git, api, out);

    await actions.stdoutTargetBranch();

    assertSpyCall(errorSpy, 0);
  });
});

// TODO handle no proper origin branch exists
