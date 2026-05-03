import { render, screen } from "@testing-library/react";

import { HealthBadge } from "@/components/HealthBadge";

describe("HealthBadge", () => {
  it("shows the loading state initially", () => {
    render(<HealthBadge status="loading" />);
    const badge = screen.getByTestId("health-badge");
    expect(badge).toHaveTextContent(/checking/i);
    expect(badge).toHaveAttribute("data-status", "loading");
  });

  it("shows the healthy state with the success copy", () => {
    render(<HealthBadge status="healthy" />);
    const badge = screen.getByTestId("health-badge");
    expect(badge).toHaveTextContent("Healthy");
    expect(badge).toHaveAttribute("data-status", "healthy");
  });

  it("shows the down state with the failure copy", () => {
    render(<HealthBadge status="down" />);
    const badge = screen.getByTestId("health-badge");
    expect(badge).toHaveTextContent("Down");
    expect(badge).toHaveAttribute("data-status", "down");
  });
});
