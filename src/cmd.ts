export interface CmdResult {
  stdout: string;
  success: boolean;
  stdError: string;
}

export async function cmd(
  cmd: string[],
): Promise<CmdResult> {
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
    return {
      stdout: "",
      success: false,
      stdError: errorString,
    };
  }
}
