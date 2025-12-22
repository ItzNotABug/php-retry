import { XMLParser } from 'fast-xml-parser';
import * as fs from 'fs';
import type { FailedTest, JUnitXML, TestSuite } from '../types.js';

export class JUnitParser {
  parseXMLFile(xmlPath: string): FailedTest[] {
    const xmlContent = fs.readFileSync(xmlPath, 'utf-8');
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });
    const result = parser.parse(xmlContent) as JUnitXML;

    const failures: FailedTest[] = [];

    let testsuites: TestSuite[] = [];

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

  getTestStats(xmlPath: string): {
    total: number;
    failures: number;
    assertions: number;
  } {
    const xmlContent = fs.readFileSync(xmlPath, 'utf-8');
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });
    const result = parser.parse(xmlContent) as JUnitXML;

    let total = 0;
    let failures = 0;
    let assertions = 0;

    if (result.testsuites) {
      total = parseInt(result.testsuites['@_tests'] || '0', 10);
      failures = parseInt(result.testsuites['@_failures'] || '0', 10);
      assertions = parseInt(result.testsuites['@_assertions'] || '0', 10);
    } else if (result.testsuite) {
      total = parseInt(result.testsuite['@_tests'] || '0', 10);
      failures = parseInt(result.testsuite['@_failures'] || '0', 10);
      assertions = parseInt(result.testsuite['@_assertions'] || '0', 10);
    }

    return { total, failures, assertions };
  }

  private extractFailuresFromSuite(
    suite: TestSuite,
    failures: FailedTest[],
  ): void {
    if (suite?.testsuite) {
      const nestedSuites = this.ensureArray(suite.testsuite);
      for (const nestedSuite of nestedSuites) {
        this.extractFailuresFromSuite(nestedSuite, failures);
      }
    }

    const testcases = this.ensureArray(suite?.testcase);

    for (const testcase of testcases) {
      if (testcase.failure || testcase.error) {
        const fullName = testcase['@_class'];
        const methodName = testcase['@_name'];
        const file = testcase['@_file'];

        if (!fullName || !methodName || !file) {
          continue;
        }

        const className = fullName.split('\\').pop() || fullName;
        const line = parseInt(testcase['@_line'] || '0', 10);

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
