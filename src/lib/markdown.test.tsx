import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MarkdownView } from "./markdown";

const noop = () => {};

describe("MarkdownView rendering", () => {
  it("renders GFM tables", () => {
    render(
      <MarkdownView
        source={"| A | B |\n|---|---|\n| 1 | 2 |"}
        onNavigate={noop}
      />,
    );
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
  });

  it("turns [[wikilinks]] into clickable links with alias", () => {
    const nav = vi.fn();
    render(
      <MarkdownView
        source={"See [[Other Note#Sec|alias]] here and [[Plain]]."}
        onNavigate={nav}
      />,
    );
    const link = screen.getByText("alias");
    expect(link.className).toContain("wikilink");
    fireEvent.click(link);
    expect(nav).toHaveBeenCalledWith("Other Note", { background: false });
    expect(screen.getByText("Plain")).toBeTruthy();
  });

  it("passes background intent for modified wikilink clicks", () => {
    const nav = vi.fn();
    render(<MarkdownView source={"See [[Other Note]]."} onNavigate={nav} />);

    fireEvent.click(screen.getByText("Other Note"), { button: 0, metaKey: true });

    expect(nav).toHaveBeenCalledWith("Other Note", { background: true });
  });

  it("renders callouts with kind styling", () => {
    render(
      <MarkdownView
        source={"> [!warning] Careful\n> something important"}
        onNavigate={noop}
      />,
    );
    expect(screen.getByText("Careful")).toBeTruthy();
    expect(screen.getByText("something important")).toBeTruthy();
    expect(document.querySelector(".callout-warning")).toBeTruthy();
  });

  it("hides YAML frontmatter from the render", () => {
    render(
      <MarkdownView
        source={"---\ntitle: hidden\n---\n# Visible"}
        onNavigate={noop}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toBeTruthy();
    expect(screen.queryByText(/title: hidden/)).toBeNull();
  });

  it("renders math with KaTeX", () => {
    render(
      <MarkdownView source={"Inline $x^2$ math"} onNavigate={noop} />,
    );
    expect(document.querySelector(".katex")).toBeTruthy();
  });

  it("renders task lists from GFM", () => {
    render(
      <MarkdownView source={"- [x] done\n- [ ] todo"} onNavigate={noop} />,
    );
    expect(document.querySelectorAll('input[type="checkbox"]').length).toBe(2);
  });
});

describe("task checkbox toggling (view mode)", () => {
  it("clicking a checkbox toggles the source marker (and only that one)", () => {
    const onChange = vi.fn();
    const { container } = render(
      <MarkdownView source={"- [ ] a\n- [x] b"} onNavigate={noop} onToggleTask={onChange} />,
    );
    const boxes = container.querySelectorAll<HTMLInputElement>('li input[type="checkbox"]');
    expect(boxes.length).toBe(2);
    fireEvent.click(boxes[0]);
    expect(onChange).toHaveBeenLastCalledWith("- [x] a\n- [x] b");
    fireEvent.click(boxes[1]);
    expect(onChange).toHaveBeenLastCalledWith("- [ ] a\n- [ ] b");
  });
});

describe("wikilink edge cases", () => {
  it("navigates to a note whose title contains %", () => {
    const nav = vi.fn();
    render(<MarkdownView source={"[[50% Done]]"} onNavigate={nav} />);
    fireEvent.click(screen.getByText("50% Done"));
    expect(nav).toHaveBeenCalledWith("50% Done", expect.anything());
  });

  it("navigates to a note whose title contains spaces and unicode", () => {
    const nav = vi.fn();
    render(<MarkdownView source={"[[Café résumé]]"} onNavigate={nav} />);
    fireEvent.click(screen.getByText("Café résumé"));
    expect(nav).toHaveBeenCalledWith("Café résumé", expect.anything());
  });

  it("handles a malformed percent sequence without throwing", () => {
    const nav = vi.fn();
    // %zz is not a valid percent encoding — should not throw
    expect(() =>
      render(<MarkdownView source={"[[Note %zz test]]"} onNavigate={nav} />),
    ).not.toThrow();
  });

  it("navigates to the path part only when an alias is present", () => {
    const nav = vi.fn();
    render(<MarkdownView source={"[[My Note|click here]]"} onNavigate={nav} />);
    fireEvent.click(screen.getByText("click here"));
    expect(nav).toHaveBeenCalledWith("My Note", expect.anything());
  });

  it("navigates to the path part only when a heading anchor is present", () => {
    const nav = vi.fn();
    render(<MarkdownView source={"[[My Note#Section One]]"} onNavigate={nav} />);
    // Display text is the target (no alias), heading is stripped
    const link = screen.getByText("My Note");
    fireEvent.click(link);
    expect(nav).toHaveBeenCalledWith("My Note", expect.anything());
  });
});
