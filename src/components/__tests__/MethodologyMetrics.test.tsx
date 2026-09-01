// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MethodologyMetrics from "../MethodologyMetrics";
import type { MethodologyMetric } from "@/lib/methodology/types";

function metric(over: Partial<MethodologyMetric> = {}): MethodologyMetric {
  return {
    id: "measurement_coverage",
    label: "Measurement coverage",
    value: 0.5,
    status: "attention",
    reason: "Indicators with at least one item.",
    evidence: { covered: 1, total: 2 },
    ...over,
  };
}

describe("MethodologyMetrics", () => {
  it("shows the ratio behind the percentage", () => {
    render(<MethodologyMetrics metrics={[metric()]} />);
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText(/1 of 2/)).toBeInTheDocument();
  });

  // §14: a dimension with nothing to measure is not a failing dimension.
  it("renders a non-computable metric as an em dash, never as 0%", () => {
    render(
      <MethodologyMetrics
        metrics={[metric({ value: null, status: "not_computable", evidence: undefined, reason: "No indicators yet." })]}
      />,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("tells assistive technology that a null metric is not applicable", () => {
    render(<MethodologyMetrics metrics={[metric({ value: null, status: "not_computable", evidence: undefined })]} />);
    const meter = screen.getByRole("meter", { name: "Measurement coverage" });
    expect(meter).toHaveAttribute("aria-valuetext", "not computable");
    expect(meter).not.toHaveAttribute("aria-valuenow");
  });

  // §20: a dashboard with no path to the object it counts is decoration.
  it("makes each tile a way in to what it counts", async () => {
    const onSelect = vi.fn();
    render(<MethodologyMetrics metrics={[metric()]} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: /Measurement coverage/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "measurement_coverage" }));
  });

  it("shows no overall score", () => {
    render(
      <MethodologyMetrics
        metrics={[metric(), metric({ id: "construct_completeness", label: "Construct completeness", value: 1, status: "ok" })]}
      />,
    );
    expect(screen.queryByText(/overall/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole("meter")).toHaveLength(2);
  });
});
