import { describe, expect, it } from "vitest";

import { isMacPlatform } from "./platform";

describe("isMacPlatform", () => {
  it("o macOS e o iOS, pelo navigator.platform, sem diferenciar maiúsculas", () => {
    expect(["MacIntel", "MacPPC", "iPhone", "iPad", "macintosh"].map(isMacPlatform)).toEqual([true, true, true, true, true]);
  });

  it("o Windows, o Linux e a plataforma que não se sabe não são", () => {
    expect(["Win32", "Linux x86_64", ""].map(isMacPlatform)).toEqual([false, false, false]);
  });
});
