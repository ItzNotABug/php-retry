import * as core from "@actions/core";

const OS = process.platform;

export function getExecutable(shell: string): string {
  core.debug(`Resolving shell: ${shell} on platform: ${OS}`);

  // Extract shell name (handle "shell --flags" format)
  const shellName = shell.trim().split(" ")[0];

  if (!shellName) {
    throw new Error("Shell cannot be empty");
  }

  switch (shellName) {
    case "bash":
    case "python":
    case "pwsh": {
      // Cross-platform shells
      return shell;
    }
    case "sh": {
      if (OS === "win32") {
        throw new Error(`Shell ${shellName} not allowed on OS ${OS}`);
      }
      return shell;
    }
    case "cmd":
    case "powershell": {
      if (OS !== "win32") {
        throw new Error(`Shell ${shellName} not allowed on OS ${OS}`);
      }
      // Add .exe extension and preserve any flags
      const flags = shell.slice(shellName.length); // Get everything after shell name
      const executable = shellName + ".exe" + flags;
      core.debug(`Resolved Windows executable: ${executable}`);
      return executable;
    }
    default: {
      throw new Error(
        `Shell ${shellName} not supported. See https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idstepsshell for supported shells`,
      );
    }
  }
}
