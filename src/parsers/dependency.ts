import * as fs from "fs";
import type { FailedTest } from "../types.js";

export class DependencyResolver {
  private dependencyMap = new Map<string, string[]>();

  parseTestFile(filePath: string): void {
    const content = fs.readFileSync(filePath, "utf-8");

    // Extract namespace + class name
    const namespaceMatch = content.match(/namespace\s+([\w\\]+)/);
    const namespace = namespaceMatch ? namespaceMatch[1] + "\\" : "";

    // Extract class name (handles abstract, final, and regular classes)
    const classMatch = content.match(/(?:abstract\s+|final\s+)?class\s+(\w+)/);
    if (!classMatch) return;
    const className = classMatch[1]!;
    const fullClassName = namespace + className;

    // Regex to find test methods with their docblocks
    const methodRegex = /\/\*\*([\s\S]*?)\*\/\s*public\s+function\s+(test\w+)/g;

    let match;
    while ((match = methodRegex.exec(content)) !== null) {
      const docblock = match[1];
      const methodName = match[2];

      if (!docblock || !methodName) continue;

      // Extract @depends annotations
      const dependsRegex = /@depends\s+(\w+(?:::\w+)?)/g;
      const dependencies: string[] = [];

      let depMatch;
      while ((depMatch = dependsRegex.exec(docblock)) !== null) {
        const dep = depMatch[1];
        if (!dep) continue;

        // Handle both same-class (@depends testMethodName) and cross-class (@depends ClassName::testMethod)
        if (dep.includes("::")) {
          // Cross-class dependency (ClassName::testMethod)
          dependencies.push(dep);
        } else {
          // Same-class dependency - prefix with current class
          dependencies.push(`${fullClassName}::${dep}`);
        }
      }

      if (dependencies.length > 0) {
        const key = `${fullClassName}::${methodName}`;
        this.dependencyMap.set(key, dependencies);
      }
    }
  }

  // Recursively resolve all dependencies for a test method
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

  // Build dependency tree visualization
  buildDependencyTree(failedTests: FailedTest[]): string {
    const lines: string[] = [];

    for (const test of failedTests) {
      const chain = this.buildDependencyChain(test.name);
      if (chain.length > 1) {
        // Has dependencies - show chain
        for (let i = 0; i < chain.length; i++) {
          const indent = "  ".repeat(i);
          const connector = i === 0 ? "" : "└─> ";
          const label =
            i === chain.length - 1 ? `${chain[i]} (FAILED)` : chain[i]!;
          lines.push(`${indent}${connector}${label}`);
        }
      } else {
        // No dependencies - show standalone
        lines.push(`  ${test.name} (FAILED)`);
      }
    }

    return lines.join("\n");
  }

  // Build dependency chain from root to target test
  private buildDependencyChain(methodName: string): string[] {
    const chain: string[] = [];
    const visited = new Set<string>();

    const buildChain = (current: string): boolean => {
      if (visited.has(current)) return false;
      visited.add(current);

      // Find what depends on this method
      for (const [test, deps] of this.dependencyMap.entries()) {
        if (deps.includes(current)) {
          if (buildChain(test)) {
            chain.unshift(current);
            return true;
          }
        }
      }

      // Base case: this is a root test
      if (current === methodName) {
        chain.push(current);
        return true;
      }

      return false;
    };

    // Start from the target test and work backwards
    const deps = this.dependencyMap.get(methodName) || [];
    if (deps.length > 0) {
      // This test has dependencies - find the chain
      const rootDeps = this.findRootDependencies(methodName, new Set());
      if (rootDeps.size > 0) {
        // Build chain from first root
        const root = Array.from(rootDeps)[0]!;
        const fullChain = this.buildChainFromRoot(root, methodName);
        return fullChain;
      }
    }

    // No dependencies - return just the method
    return [methodName];
  }

  // Find root dependencies (methods with no @depends)
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

  // Build chain from root to target
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

      // Find tests that depend on current
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

  // Build --filter pattern from failed tests
  buildFilterPattern(failedTests: FailedTest[]): string {
    const allTests = new Set<string>();

    for (const test of failedTests) {
      // Use full name (Class::method) as key
      const key = test.name; // Already in format "Class::method"
      const deps = this.resolveDependencies(key);
      deps.forEach((fullName) => {
        // Use full Class::method to avoid cross-class collisions
        // PHPUnit --filter accepts this format as regex
        allTests.add(fullName);
      });
    }

    // Join with pipe for PHPUnit --filter regex
    return Array.from(allTests).join("|");
  }
}
