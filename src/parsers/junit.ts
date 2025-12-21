import { XMLParser } from "fast-xml-parser";
import * as fs from "fs";
import type { FailedTest } from "../types.js";

export class JUnitParser {
  parseXMLFile(xmlPath: string): FailedTest[] {
    const xmlContent = fs.readFileSync(xmlPath, "utf-8");
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
    });
    const result = parser.parse(xmlContent);

    const failures: FailedTest[] = [];

    let testsuites: any[] = [];

    if (result.testsuites) {
      testsuites = this.ensureArray(result.testsuites.testsuite);
    } else if (result.testsuite) {
      testsuites = this.ensureArray(result.testsuite);
    }

    for (const suite of testsuites) {
      this.extractFailuresFromSuite(suite, failures);
    }

    return failures;
  }

  private extractFailuresFromSuite(suite: any, failures: FailedTest[]): void {
    if (suite?.testsuite) {
      const nestedSuites = this.ensureArray(suite.testsuite);
      for (const nestedSuite of nestedSuites) {
        this.extractFailuresFromSuite(nestedSuite, failures);
      }
    }

    const testcases = this.ensureArray(suite?.testcase);

    for (const testcase of testcases) {
      if (testcase.failure || testcase.error) {
        const fullName = testcase["@_class"];
        const methodName = testcase["@_name"];
        const file = testcase["@_file"];

        if (!fullName || !methodName || !file) {
          continue;
        }

        const className = fullName.split("\\").pop() || fullName;
        const line = parseInt(testcase["@_line"] || "0", 10);

        failures.push({
          name: `${fullName}::${methodName}`,
          class: className,
          method: methodName,
          file: file,
          line: line,
        });
      }
    }
  }

  private ensureArray<T>(value: T | T[] | undefined): T[] {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
  }
}
