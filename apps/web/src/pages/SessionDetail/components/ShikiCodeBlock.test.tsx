import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { highlightCodeMock, peekHighlightedCodeMock, resetShikiHighlighterMock } = vi.hoisted(
  () => ({
    highlightCodeMock: vi.fn(),
    peekHighlightedCodeMock: vi.fn(),
    resetShikiHighlighterMock: vi.fn(),
  }),
);

vi.mock("@/lib/shiki/highlighter", () => ({
  highlightCode: highlightCodeMock,
  peekHighlightedCode: peekHighlightedCodeMock,
  resetShikiHighlighter: resetShikiHighlighterMock,
}));

import { ShikiCodeBlock } from "./ShikiCodeBlock";

const highlighted = (text: string) => ({
  html: `<pre class="shiki"><code><span class="line">${text}</span></code></pre>`,
  language: "txt",
});

describe("ShikiCodeBlock", () => {
  beforeEach(() => {
    highlightCodeMock.mockReset();
    peekHighlightedCodeMock.mockReset().mockReturnValue(null);
    resetShikiHighlighterMock.mockReset();
  });

  it("preserves empty lines when line numbers are enabled", async () => {
    highlightCodeMock.mockResolvedValue({
      html:
        '<pre class="shiki"><code><span class="line"><span style="color:#fff">first</span></span>\n' +
        '<span class="line"></span>\n' +
        '<span class="line"><span style="color:#fff">third</span></span>\n' +
        "</code></pre>",
      language: "txt",
    });

    const { container } = render(
      <ShikiCodeBlock code={"first\n\nthird"} language="txt" theme="latte" showLineNumbers />,
    );

    await waitFor(() => {
      expect(container.querySelectorAll(".line")).toHaveLength(3);
    });
    const lines = container.querySelectorAll(".line");
    expect(lines[1]?.textContent).toBe("\u200B");
  });

  it("highlights the requested line", async () => {
    highlightCodeMock.mockResolvedValue({
      html:
        '<pre class="shiki"><code><span class="line">a</span>\n' +
        '<span class="line">b</span>\n' +
        '<span class="line">c</span>\n' +
        "</code></pre>",
      language: "txt",
    });

    const { container } = render(
      <ShikiCodeBlock code={"a\nb\nc"} language="txt" theme="latte" highlightLine={2} />,
    );

    await waitFor(() => {
      expect(container.querySelector(".vde-shiki-target-line")?.textContent).toBe("b");
    });
  });
  it("shows cached code immediately and rejects an obsolete highlight response", async () => {
    let resolveFirst!: (value: ReturnType<typeof highlighted>) => void;
    highlightCodeMock
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(highlighted("second"));
    peekHighlightedCodeMock.mockReturnValue(highlighted("cached first"));
    const view = render(<ShikiCodeBlock code="first" language="txt" theme="latte" />);
    expect(view.container.textContent).toContain("cached first");
    peekHighlightedCodeMock.mockReturnValue(null);
    view.rerender(<ShikiCodeBlock code="second" language="txt" theme="mocha" />);
    expect(view.container.textContent).not.toContain("cached first");
    await waitFor(() => expect(view.container.textContent).toContain("second"));
    await act(async () => resolveFirst(highlighted("obsolete")));
    expect(view.container.textContent).not.toContain("obsolete");
  });

  it("retries a failure and clears errors when returning to a previously failed request", async () => {
    highlightCodeMock.mockReset().mockRejectedValueOnce(new Error("offline"));
    peekHighlightedCodeMock.mockReturnValue(null);
    resetShikiHighlighterMock.mockReset();
    const view = render(<ShikiCodeBlock code="first" language="txt" theme="latte" />);
    await waitFor(() => expect(screen.queryByText(/Failed to initialize/)).not.toBeNull());
    expect(view.container.querySelector("pre")?.textContent).toBe("first");
    highlightCodeMock.mockImplementation(() => new Promise(() => {}));
    view.rerender(<ShikiCodeBlock code="second" language="txt" theme="latte" />);
    view.rerender(<ShikiCodeBlock code="first" language="txt" theme="latte" />);
    expect(screen.queryByText(/Failed to initialize/)).toBeNull();
    highlightCodeMock.mockRejectedValueOnce(new Error("retryable"));
    view.rerender(<ShikiCodeBlock code="third" language="txt" theme="latte" />);
    await waitFor(() => expect(screen.queryByText(/Failed to initialize/)).not.toBeNull());
    highlightCodeMock.mockResolvedValueOnce(highlighted("third"));
    fireEvent.click(screen.getByRole("button", { name: "Retry highlight" }));
    expect(resetShikiHighlighterMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Failed to initialize/)).toBeNull();
    await waitFor(() => expect(view.container.querySelector(".line")?.textContent).toBe("third"));
  });

  it("resets scroll for a new request and preserves user scroll when highlighting completes", async () => {
    let resolveHighlight!: (value: ReturnType<typeof highlighted>) => void;
    highlightCodeMock.mockReset().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveHighlight = resolve;
        }),
    );
    peekHighlightedCodeMock.mockReturnValue(null);
    const view = render(<ShikiCodeBlock code="first" language="txt" theme="latte" />);
    const scroller = view.container.querySelector(".custom-scrollbar") as HTMLDivElement;
    scroller.scrollLeft = 42;
    scroller.scrollTop = 80;
    fireEvent.scroll(scroller);
    await act(async () => resolveHighlight(highlighted("first")));
    expect(scroller.scrollLeft).toBe(42);
    expect(scroller.scrollTop).toBe(80);
    peekHighlightedCodeMock.mockReturnValue(highlighted("second"));
    view.rerender(<ShikiCodeBlock code="second" language="txt" theme="mocha" />);
    expect(scroller.scrollLeft).toBe(0);
    expect(scroller.scrollTop).toBe(0);
  });
});
