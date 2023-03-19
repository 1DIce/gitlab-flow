#! /usr/bin/env -S deno run --allow-run --allow-env --allow-net --allow-read --no-check

import { replaceConfig } from "./src/config.ts";
import { ConfigFileReader } from "./src/config-file-reader.ts";
import { FileSystem } from "./src/file-system.ts";
import { Command, HelpCommand } from "./dependencies/cliffy.deps.ts";
import { Actions } from "./src/actions.ts";
import { environment } from "./environment.ts";
import { GitlabApi } from "./src/gitlab-api.ts";
import { Git } from "./src/git.ts";
import { Output } from "./src/output.ts";
import { ExitCode } from "./src/exit-code.ts";

const fs = new FileSystem();
const git = new Git();
const api = new GitlabApi();

function initializeConfig(out: Output): void {
  const configFile = new ConfigFileReader(fs, out).loadConfigFile();
  if (!configFile) {
    console.error("Error: No configuration file was found!");
    Deno.exit(ExitCode.FAILIURE);
  }
  replaceConfig(configFile);
}

async function validateIsGitRepo(out: Output) {
  const gitRoot = await git.getGitRoot();
  if (!gitRoot) {
    out.errorln(
      "Error: The current working directory is not inside a git directory",
    );
    Deno.exit(ExitCode.FAILIURE);
  }
}

async function main() {
  await new Command()
    .name(environment.binaryName)
    .usage("<command> [options]")
    .version(environment.version)
    .meta("deno", Deno.version.deno)
    .description("Command line interface for gitlab merge request workflows")
    .env(
      "GITLAB_API_TOKEN=<value:string>",
      "Gitlab API token that is used to authenticate yourself",
    )
    .option("--debug", "Output debug information", {
      global: true,
      default: false,
    })
    .option(
      "-f, --force",
      "Use force push",
      { global: true, default: false },
    )
    .command(
      "create [options]",
    )
    .alias("c")
    .description(
      `Create a new merge request with fromt he current git branch.
          A remote branch is created if it does not exist.
          By default the merge request is marked as a draft,
          `,
    )
    .option(
      "-p, --publish",
      "The merge request is marked as ready",
      { conflicts: ["draft"] },
    )
    .option(
      "-d, --draft",
      "The merge request is marked as draft",
      { conflicts: ["publish"] },
    )
    .action(
      async (params) => {
        const out = new Output(params.debug);
        const actions = new Actions(git, api, out);
        initializeConfig(out);
        await validateIsGitRepo(out);
        await actions.pushToMergeRequest({
          draft: params.draft != null ? params.draft : !params.publish,
          force: params.force,
        });
      },
    )
    .reset()
    .command(
      "file-change <file_path:string>",
    )
    .alias("fc")
    .description(
      "Get the url to a change of the provided file in the open merge request",
    )
    .action(async (params, file_path) => {
      const out = new Output(params.debug);
      const actions = new Actions(git, api, out);
      initializeConfig(out);
      await actions.stdoutRemoteFileChangeUrl(file_path);
    })
    .reset()
    .command(
      "target",
    )
    .description(
      "Output merge request target branch name if merge request for the current branch exists",
    )
    .action(async (params) => {
      const out = new Output(params.debug);
      const actions = new Actions(git, api, out);
      initializeConfig(out);
      await validateIsGitRepo(out);
      const exitCode = await actions.stdoutTargetBranch();
      Deno.exit(exitCode);
    })
    .command("help", new HelpCommand().global())
    .parse(Deno.args);
}

main();
