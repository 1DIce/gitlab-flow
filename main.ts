#! /usr/bin/env -S deno run --allow-run --allow-env --allow-net --allow-read --no-check

import { replaceConfig } from "./src/config.ts";
import { ConfigFileReader } from "./src/config-file-reader.ts";
import { FileSystem } from "./src/file-system.ts";
import { Command, HelpCommand } from "./dependencies/cliffy.deps.ts";
import { Actions } from "./src/actions.ts";
import { environment } from "./environment.ts";
import { GitlabApi } from "./src/gitlab-api.ts";

const fs = new FileSystem();
const git = new Git();
const api = new GitlabApi();
const actions = new Actions(git, api);

function initializeConfig(): void {
  const configFile = new ConfigFileReader(fs).loadConfigFile();
  if (!configFile) {
    console.error("Error: No configuration file was found!");
    Deno.exit(1);
  }
  replaceConfig(configFile);
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
      `Uploads new changes to merge request.
          A remote branch is created if it does not exist.
          A merge request is created if it does not exist.
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
      (params) => {
        initializeConfig();
        actions.pushToMergeRequest({
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
      "Get url to change of the provided file in the open merge request",
    )
    .action((_params, file_path) => {
      initializeConfig();
      actions.stdoutRemoteFileChangeUrl(file_path);
    })
    .reset()
    .command(
      "target",
    )
    .description(
      "Get merge request target branch if merge request for the current branch exists",
    )
    .action((_params) => {
      initializeConfig();
      actions.stdoutTargetBranch();
    })
    .command("help", new HelpCommand().global())
    .parse(Deno.args);
}

main();
