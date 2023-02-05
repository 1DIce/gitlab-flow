#! /usr/bin/env -S deno run --allow-run --allow-env --allow-net --allow-read --no-check

import { replaceConfig } from "./src/config.ts";
import { ConfigFileReader } from "./src/config-file-reader.ts";
import { FileSystem } from "./src/file-system.ts";
import { Command } from "./dependencies/cliffy.deps.ts";
import {
  pushToMergeRequest,
  stdoutRemoteFileChangeUrl,
  stdoutTargetBranch,
} from "./src/gitlab-cli.ts";
import { environment } from "./environment.ts";

const fs = new FileSystem();

async function main() {
  const configFile = new ConfigFileReader(fs).loadConfigFile();
  if (!configFile) {
    console.error("Error: No configuration file was found!");
    Deno.exit(1);
  }
  replaceConfig(configFile);

  await new Command()
    .name(environment.binaryName)
    .version(environment.version)
    .description("Command line interface for gitlab workflows")
    .env(
      "GITLAB_API_TOKEN=<value:string>",
      "Gitlab api token that is used to communicate with the API",
    )
    .option(
      "-f, --force",
      "Use force push",
      { global: true, default: false },
    )
    .command(
      "publish",
      `Uploads new changes to merge request.
        A remote branch is created if it does not exist.
        A merge request is created if it does not exist.
        The merge request is marked as ready if it was a draft`,
    )
    .action((params) =>
      pushToMergeRequest({ draft: false, force: params.force })
    )
    .reset()
    .command(
      "draft",
      `Uploads new changes to merge request.
        A remote branch is created if it does not exist.
        A merge request is created if it does not exist.
        The merge request is marked as a draft`,
    ).action((params) =>
      pushToMergeRequest({ draft: true, force: params.force })
    )
    .reset()
    .command(
      "file-change <file_path:string>",
      "Get url to change of the provided file in the open merge request",
    ).action((_params, file_path) => stdoutRemoteFileChangeUrl(file_path))
    .reset()
    .command(
      "target",
      "Get merge request target branch",
    ).action((_params) => stdoutTargetBranch())
    .parse(Deno.args);
}

main();
