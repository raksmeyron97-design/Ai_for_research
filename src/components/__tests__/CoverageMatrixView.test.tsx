// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CoverageMatrixView from "../CoverageMatrixView";
import { buildCoverageMatrix } from "@/lib/methodology/coverage";
import { construct, indicator, item, model } from "@/lib/methodology/__tests__/fixtures";

describe("CoverageMatrixView", () => {
  it("explains what the matrix will show when there is nothing yet", () => {
    render(<CoverageMatrixView matrix={buildCoverageMatrix(model())} />);
    expect(screen.getByText(/No constructs yet/i)).toBeInTheDocument();
  });

  it("names an indicator with no item", () => {
    const c = construct({ id: "con-a" });
    const bare = indicator({ id: "ind-b", construct_id: c.id, name: "Effort" });
    render(
      <CoverageMatrixView matrix={buildCoverageMatrix(model({ constructs: [c], indicators: [bare] }))} />,
    );
    expect(screen.getByText("Effort")).toBeInTheDocument();
    expect(screen.getByText("no items")).toBeInTheDocument();
  });

  it("groups indicators under their dimension", () => {
    const c = construct({ id: "con-a" });
    render(
      <CoverageMatrixView
        matrix={buildCoverageMatrix(
          model({
            constructs: [c],
            indicators: [indicator({ id: "ind-a", construct_id: c.id, dimension: "Intrinsic motivation" })],
          }),
        )}
      />,
    );
    expect(screen.getByText("Intrinsic motivation")).toBeInTheDocument();
  });

  it("separates items that measure nothing", () => {
    const c = construct({ id: "con-a" });
    render(
      <CoverageMatrixView
        matrix={buildCoverageMatrix(
          model({
            constructs: [c],
            items: [item({ id: "q-x", construct_id: null, indicator_id: null, question_text: "Stray item" })],
          }),
        )}
      />,
    );
    expect(screen.getByText("Items measuring nothing (1)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stray item" })).toBeInTheDocument();
  });

  // §12: an "optimal item count" is a convention, not a fact, and printing one
  // would turn it into a requirement the researcher never chose.
  it("suggests no target number of items", () => {
    const c = construct({ id: "con-a" });
    const i = indicator({ id: "ind-a", construct_id: c.id });
    render(
      <CoverageMatrixView
        matrix={buildCoverageMatrix(
          model({ constructs: [c], indicators: [i], items: [item({ id: "q-a", indicator_id: i.id, construct_id: c.id })] }),
        )}
      />,
    );
    expect(screen.getByText("1 item")).toBeInTheDocument();
    expect(screen.queryByText(/recommended|should have|at least three/i)).not.toBeInTheDocument();
  });

  it("leads to the indicator and the item behind each row", async () => {
    const onSelectIndicator = vi.fn();
    const onSelectItem = vi.fn();
    const c = construct({ id: "con-a" });
    const i = indicator({ id: "ind-a", construct_id: c.id, name: "Job satisfaction" });
    render(
      <CoverageMatrixView
        matrix={buildCoverageMatrix(
          model({
            constructs: [c],
            indicators: [i],
            items: [item({ id: "q-a", indicator_id: i.id, construct_id: c.id, question_text: "I enjoy my work." })],
          }),
        )}
        onSelectIndicator={onSelectIndicator}
        onSelectItem={onSelectItem}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Job satisfaction" }));
    expect(onSelectIndicator).toHaveBeenCalledWith("ind-a");
    await userEvent.click(screen.getByRole("button", { name: "I enjoy my work." }));
    expect(onSelectItem).toHaveBeenCalledWith("q-a");
  });
});
