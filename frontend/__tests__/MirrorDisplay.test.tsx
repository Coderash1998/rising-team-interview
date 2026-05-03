import { render, screen } from "@testing-library/react";

import { MirrorDisplay } from "@/components/MirrorDisplay";

describe("MirrorDisplay", () => {
  const PLACEHOLDER = "Start typing to see it come alive.";

  it("renders the placeholder when text is empty", () => {
    render(<MirrorDisplay text="" placeholder={PLACEHOLDER} />);
    const primary = screen.getByTestId("mirror-primary");
    expect(primary).toHaveTextContent(PLACEHOLDER);
    expect(primary).toHaveAttribute("data-empty", "true");
  });

  it("mirrors the typed text in the primary display", () => {
    render(<MirrorDisplay text="hello world" placeholder={PLACEHOLDER} />);
    const primary = screen.getByTestId("mirror-primary");
    expect(primary).toHaveTextContent("hello world");
    expect(primary).toHaveAttribute("data-empty", "false");
  });

  it("preserves spaces and casing exactly", () => {
    render(<MirrorDisplay text="  Mixed CASE  " placeholder={PLACEHOLDER} />);
    expect(screen.getByTestId("mirror-primary").textContent).toContain("Mixed CASE");
  });
});
