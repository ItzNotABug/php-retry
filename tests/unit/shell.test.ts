import "./test-helper";
import { describe, test, expect } from "bun:test";
import { getExecutable } from "../../src/utils/shell";

describe("getExecutable", () => {
  const isWindows = process.platform === "win32";

  describe("cross-platform shells", () => {
    test("should support bash", () => {
      expect(getExecutable("bash")).toBe("bash");
    });

    test("should support python", () => {
      expect(getExecutable("python")).toBe("python");
    });

    test("should support pwsh", () => {
      expect(getExecutable("pwsh")).toBe("pwsh");
    });

    test("should preserve shell flags", () => {
      expect(getExecutable("bash -e")).toBe("bash -e");
      expect(getExecutable("python -u")).toBe("python -u");
    });
  });

  describe("platform-specific shells", () => {
    if (!isWindows) {
      test("should support sh on unix", () => {
        expect(getExecutable("sh")).toBe("sh");
      });

      test("should reject cmd on unix", () => {
        expect(() => getExecutable("cmd")).toThrow("not allowed");
      });

      test("should reject powershell on unix", () => {
        expect(() => getExecutable("powershell")).toThrow("not allowed");
      });
    } else {
      test("should support cmd on windows", () => {
        expect(getExecutable("cmd")).toBe("cmd.exe");
      });

      test("should support powershell on windows", () => {
        expect(getExecutable("powershell")).toBe("powershell.exe");
      });

      test("should preserve flags for windows shells", () => {
        expect(getExecutable("cmd /c")).toBe("cmd.exe /c");
        expect(getExecutable("powershell -Command")).toBe(
          "powershell.exe -Command"
        );
      });

      test("should reject sh on windows", () => {
        expect(() => getExecutable("sh")).toThrow("not allowed");
      });
    }
  });

  describe("validation", () => {
    test("should reject empty shell", () => {
      expect(() => getExecutable("")).toThrow("Shell cannot be empty");
    });

    test("should reject whitespace-only shell", () => {
      expect(() => getExecutable("   ")).toThrow("Shell cannot be empty");
    });

    test("should reject unsupported shell", () => {
      expect(() => getExecutable("fish")).toThrow("Shell fish not supported");
    });

    test("should reject invalid shell", () => {
      expect(() => getExecutable("zsh")).toThrow("Shell zsh not supported");
    });
  });

  describe("shell name extraction", () => {
    test("should extract shell name from command with flags", () => {
      expect(getExecutable("bash -e -o pipefail")).toBe("bash -e -o pipefail");
    });

    test("should trim extra whitespace", () => {
      expect(getExecutable("  bash  ")).toBe("bash");
      expect(getExecutable("  bash -e  ")).toBe("bash -e");
    });

    test("should normalize multiple spaces to single space", () => {
      expect(getExecutable("bash   -e")).toBe("bash -e");
      expect(getExecutable("bash    -e    -o    pipefail")).toBe("bash -e -o pipefail");
    });

    test("should normalize tabs to spaces", () => {
      expect(getExecutable("bash\t-e")).toBe("bash -e");
      expect(getExecutable("python\t-u")).toBe("python -u");
    });
  });
});
