import { describe, expect, it } from "vitest";
import { addRestLabel, currentPlatform, howToQuitChrome } from "./messages";

describe("messages", () => {
  it("tells the three systems apart from the web view's user agent", () => {
    expect(currentPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15")).toBe("mac");
    expect(currentPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edg/130.0")).toBe("windows");
    expect(currentPlatform("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15")).toBe("linux");
  });

  it("explains how to quit Chrome on each system", () => {
    expect(howToQuitChrome("mac")).toContain("⌘Q");
    expect(howToQuitChrome("windows")).toContain("Exit");
    expect(howToQuitChrome("linux")).toContain("Exit");
  });

  it("labels the button for finishing an earlier list", () => {
    expect(addRestLabel(1, 1, "Work")).toBe("Add it to Work");
    expect(addRestLabel(1, 5, "Work")).toBe("Add the last one to Work");
    expect(addRestLabel(5, 5, "Work")).toBe("Add all 5 to Work");
    expect(addRestLabel(3, 5, "Work")).toBe("Add the other 3 to Work");
  });
});
