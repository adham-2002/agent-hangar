import { describe, expect, it } from "vitest";

// UTF-8 text decoded as Windows-1252 and saved again turns "·" into "Â·" and
// "—" into "â€”". Those pairs never appear in real copy, so finding one means a
// file was re-encoded by a tool and users would see the garbage.
const MOJIBAKE = /Â[\u0080-ÿ]|â€|Ã[\u0080-¿]/;

const sources = import.meta.glob<string>(["/src/**/*.{ts,tsx,json}", "!/src/lib/encoding.test.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
});

describe("source encoding", () => {
  it("reads the sources", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50);
  });

  it("has no text mangled by a wrong-encoding save", () => {
    const bad = Object.entries(sources)
      .filter(([, text]) => MOJIBAKE.test(text))
      .map(([path]) => path);
    expect(bad).toEqual([]);
  });
});
