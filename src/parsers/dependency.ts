import * as fs from 'fs';
import type { FailedTest } from '../types.js';

export class DependencyResolver {
  private dependencyMap = new Map<string, string[]>();

  parseTestFile(filePath: string): void {
    const content = fs.readFileSync(filePath, 'utf-8');

    const namespaceMatch = content.match(/namespace\s+([\w\\]+)/);
    const namespace = namespaceMatch ? namespaceMatch[1] + '\\' : '';

    const classMatch = content.match(/(?:abstract\s+|final\s+)?class\s+(\w+)/);
    if (!classMatch) return;
    const className = classMatch[1]!;
    const fullClassName = namespace + className;

    const methodRegex = /\/\*\*([\s\S]*?)\*\/\s*public\s+function\s+(test\w+)/g;

    let match;
    while ((match = methodRegex.exec(content)) !== null) {
      const docblock = match[1];
      const methodName = match[2];

      if (!docblock || !methodName) continue;

      const dependsRegex = /@depends\s+(\w+(?:::\w+)?)/g;
      const dependencies: string[] = [];

      let depMatch;
      while ((depMatch = dependsRegex.exec(docblock)) !== null) {
        const dep = depMatch[1];
        if (!dep) continue;

        if (dep.includes('::')) {
          dependencies.push(dep);
        } else {
          dependencies.push(`${fullClassName}::${dep}`);
        }
      }

      if (dependencies.length > 0) {
        const key = `${fullClassName}::${methodName}`;
        this.dependencyMap.set(key, dependencies);
      }
    }
  }

  private resolveDependencies(
    methodName: string,
    visited = new Set<string>(),
  ): Set<string> {
    const result = new Set<string>();
    result.add(methodName);

    if (visited.has(methodName)) {
      // Circular dependency detected - still include the method but don't recurse
      return result;
    }

    visited.add(methodName);

    const deps = this.dependencyMap.get(methodName) || [];
    for (const dep of deps) {
      const subDeps = this.resolveDependencies(dep, new Set(visited));
      subDeps.forEach((d) => result.add(d));
    }

    return result;
  }

  buildDependencyTree(failedTests: FailedTest[]): string {
    const lines: string[] = [];

    for (const test of failedTests) {
      const chain = this.buildDependencyChain(test.name);
      if (chain.length > 1) {
        for (let i = 0; i < chain.length; i++) {
          const indent = '  '.repeat(i);
          const connector = i === 0 ? '' : '└─> ';
          const label =
            i === chain.length - 1 ? `${chain[i]} (FAILED)` : chain[i]!;
          lines.push(`${indent}${connector}${label}`);
        }
      } else {
        lines.push(`  ${test.name} (FAILED)`);
      }
    }

    return lines.join('\n');
  }

  private buildDependencyChain(methodName: string): string[] {
    const deps = this.dependencyMap.get(methodName) || [];
    if (deps.length > 0) {
      const rootDeps = this.findRootDependencies(methodName, new Set());
      if (rootDeps.size > 0) {
        const root = Array.from(rootDeps)[0]!;
        return this.buildChainFromRoot(root, methodName);
      }
    }

    return [methodName];
  }

  private findRootDependencies(
    methodName: string,
    visited: Set<string>,
  ): Set<string> {
    if (visited.has(methodName)) return new Set();
    visited.add(methodName);

    const deps = this.dependencyMap.get(methodName) || [];
    if (deps.length === 0) {
      return new Set([methodName]);
    }

    const roots = new Set<string>();
    for (const dep of deps) {
      const subRoots = this.findRootDependencies(dep, new Set(visited));
      subRoots.forEach((r) => roots.add(r));
    }

    return roots;
  }

  private buildChainFromRoot(root: string, target: string): string[] {
    if (root === target) return [root];

    const queue: Array<{ current: string; path: string[] }> = [
      { current: root, path: [root] },
    ];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const { current, path } = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);

      for (const [test, deps] of this.dependencyMap.entries()) {
        if (deps.includes(current)) {
          const newPath = [...path, test];
          if (test === target) {
            return newPath;
          }
          queue.push({ current: test, path: newPath });
        }
      }
    }

    return [root];
  }

  buildFilterPattern(failedTests: FailedTest[]): string {
    const allTests = new Set<string>();

    for (const test of failedTests) {
      const key = test.name;
      const deps = this.resolveDependencies(key);
      deps.forEach((fullName) => {
        allTests.add(fullName);
      });
    }

    return Array.from(allTests)
      .map(
        (test) => `${test}$`,
      ) /* `testCreateProject` should not match `testCreateProjectSMTPTests` */
      .join('|');
  }
}
