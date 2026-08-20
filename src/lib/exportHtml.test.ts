import { describe, it, expect } from "vitest";
import { buildExportHtml } from "./exportHtml";

describe("buildExportHtml", () => {
  it("produces a self-contained HTML document with rendered markdown", async () => {
    const md = "| A | B |\n|---|---|\n| 1 | 2 |\n\nSee [[Other Note]] here.";
    const html = await buildExportHtml(md, "My Note");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<table");
    expect(html).toContain("<style>");
    // wikilink becomes a relative .md link
    expect(html).toContain('href="Other Note.md"');
    expect(html).toContain("<title>My Note</title>");
  });

  it("renders callouts and math", async () => {
    const md = "> [!warning] Careful\n> body\n\nInline $x^2$ math";
    const html = await buildExportHtml(md, "notes");
    expect(html).toContain("callout");
    expect(html).toContain("katex");
  });

  it("correctly exports wikilinks with % in the title", async () => {
    const html = await buildExportHtml("[[50% Done]]", "test");
    expect(html).toContain('href="50% Done.md"');
    expect(html).not.toContain("vault://");
  });

  it("correctly exports wikilinks with spaces and unicode", async () => {
    const html = await buildExportHtml("[[Café résumé]]", "test");
    expect(html).toContain('href="Café résumé.md"');
  });

  it("exports only the path part of a wikilink with heading anchor", async () => {
    const html = await buildExportHtml("[[My Note#Section One]]", "test");
    expect(html).toContain('href="My Note.md"');
    expect(html).not.toContain("#Section");
  });
});
