export class CommandBuilder {
  private readonly containerJunitPath = '/tmp/phpunit-junit.xml';

  private isDockerCommand(command: string): boolean {
    return (
      command.includes('docker exec') ||
      command.includes('docker compose exec') ||
      command.includes('docker-compose exec')
    );
  }

  extractJUnitPath(command: string): string | null {
    const match = command.match(/--log-junit\s+(\S+)/);
    return match ? match[1]! : null;
  }

  addJUnitLogging(command: string, localJunitPath: string): string {
    if (command.includes('--log-junit')) {
      return command;
    }

    const junitPath = this.isDockerCommand(command)
      ? this.containerJunitPath
      : localJunitPath;
    return `${command} --log-junit ${junitPath}`;
  }

  addFilter(command: string, filterPattern: string): string {
    // 4 backslashes needed: 2 for bash escaping, 2 for PHPUnit regex escaping
    const escaped = filterPattern
      .replace(/\\/g, '\\\\\\\\')
      .replace(/"/g, '\\"');
    return `${command} --filter "${escaped}"`;
  }

  addEnvVar(command: string, name: string, value: string): string {
    if (!this.isDockerCommand(command)) {
      return command;
    }

    const tokens = command.trim().split(/\s+/);
    let insertIdx = 0;

    if (tokens[0] === 'docker' && tokens[1] === 'exec') {
      insertIdx = 2;
    } else if (
      tokens[0] === 'docker' &&
      tokens[1] === 'compose' &&
      tokens[2] === 'exec'
    ) {
      insertIdx = 3;
    } else if (tokens[0] === 'docker-compose' && tokens[1] === 'exec') {
      insertIdx = 2;
    } else {
      return command;
    }

    const flagsWithArgs = new Set([
      '-u',
      '--user',
      '-w',
      '--workdir',
      '-e',
      '--env',
    ]);

    while (insertIdx < tokens.length && tokens[insertIdx]!.startsWith('-')) {
      const token = tokens[insertIdx]!;
      if (flagsWithArgs.has(token) && !token.includes('=')) {
        insertIdx += 2;
      } else {
        insertIdx += 1;
      }
    }

    tokens.splice(insertIdx, 0, '-e', `${name}=${value}`);
    return tokens.join(' ');
  }

  extractContainerName(command: string): string | null {
    const tokens = command.trim().split(/\s+/);

    const flagsWithArgs = new Set([
      '-u',
      '--user',
      '-w',
      '--workdir',
      '-e',
      '--env',
    ]);

    let idx = 0;

    if (tokens[idx] === 'docker' && tokens[idx + 1] === 'exec') {
      idx += 2;
    } else if (
      tokens[idx] === 'docker' &&
      tokens[idx + 1] === 'compose' &&
      tokens[idx + 2] === 'exec'
    ) {
      idx += 3;
    } else if (tokens[idx] === 'docker-compose' && tokens[idx + 1] === 'exec') {
      idx += 2;
    } else {
      return null;
    }

    while (idx < tokens.length) {
      const token = tokens[idx]!;

      if (token.startsWith('-')) {
        if (flagsWithArgs.has(token) && !token.includes('=')) {
          idx += 2;
        } else {
          idx += 1;
        }
      } else {
        return token;
      }
    }

    return null;
  }

  buildExtractCommand(
    command: string,
    destPath: string,
    customContainerPath?: string,
  ): string | null {
    const containerName = this.extractContainerName(command);
    if (!containerName) {
      return null;
    }

    const containerPath = customContainerPath || this.containerJunitPath;

    if (
      command.includes('docker compose exec') ||
      command.includes('docker-compose exec')
    ) {
      const composeCmd = command.includes('docker-compose')
        ? 'docker-compose'
        : 'docker compose';
      return `${composeCmd} cp ${containerName}:${containerPath} ${destPath}`;
    }

    return `docker cp ${containerName}:${containerPath} ${destPath}`;
  }
}
