import * as core from '@actions/core';

const OS = process.platform;

export function getExecutable(shell: string): string {
  const normalized = shell.trim().replace(/\s+/g, ' ');
  core.debug(`Resolving shell: ${normalized} on platform: ${OS}`);

  const shellName = normalized.split(' ')[0];

  if (!shellName) {
    throw new Error('Shell cannot be empty');
  }

  switch (shellName) {
    case 'bash':
    case 'python':
    case 'pwsh': {
      return normalized;
    }
    case 'sh': {
      if (OS === 'win32') {
        throw new Error(`Shell ${shellName} not allowed on OS ${OS}`);
      }
      return normalized;
    }
    case 'cmd':
    case 'powershell': {
      if (OS !== 'win32') {
        throw new Error(`Shell ${shellName} not allowed on OS ${OS}`);
      }
      const flags = normalized.slice(shellName.length);
      const executable = shellName + '.exe' + flags;
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
