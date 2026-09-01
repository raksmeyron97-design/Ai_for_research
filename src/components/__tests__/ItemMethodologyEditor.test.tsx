// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ItemMethodologyEditor from "../ItemMethodologyEditor";
import { construct, indicator, item, scale } from "@/lib/methodology/__tests__/fixtures";

const CONSTRUCTS = [construct({ id: "con-a", name: "Teacher motivation" }), construct({ id: "con-b", name: "Student performance" })];
const INDICATORS = [
  indicator({ id: "ind-a", construct_id: "con-a", name: "Job satisfaction" }),
  indicator({ id: "ind-b", construct_id: "con-b", name: "Exam score" }),
];
const SCALES = [scale({ id: "sc-a", name: "Agreement 1-5" })];

function setup(props: Partial<Parameters<typeof ItemMethodologyEditor>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <ItemMethodologyEditor
      item={item({ id: "q-a", construct_id: "con-a", indicator_id: "ind-a", scale_id: "sc-a" })}
      constructs={CONSTRUCTS}
      indicators={INDICATORS}
      scales={SCALES}
      onChange={onChange}
      {...props}
    />,
  );
  return { onChange };
}

describe("ItemMethodologyEditor", () => {
  it("summarises the mapping without opening the editor", () => {
    setup();
    expect(screen.getByText(/Teacher motivation · Job satisfaction/)).toBeInTheDocument();
  });

  it("says plainly when an item measures nothing", () => {
    setup({ item: item({ id: "q-a", construct_id: null, indicator_id: null }) });
    expect(screen.getByText(/measures nothing yet/i)).toBeInTheDocument();
  });

  // An indicator under a different construct is a mapping the coverage matrix
  // cannot represent, so it is not offered.
  it("offers only the indicators under the chosen construct", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Measurement details" }));
    const select = screen.getByLabelText("Indicator");
    expect(within(select).queryByText("Exam score")).not.toBeInTheDocument();
    expect(within(select).getByText("Job satisfaction")).toBeInTheDocument();
  });

  it("clears the indicator when the construct changes", async () => {
    const { onChange } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Measurement details" }));
    await userEvent.selectOptions(screen.getByLabelText("Construct"), "con-b");
    expect(onChange).toHaveBeenCalledWith({ constructId: "con-b", indicatorId: null });
  });

  it("toggles reverse coding explicitly", async () => {
    const { onChange } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Measurement details" }));
    await userEvent.click(screen.getByLabelText("Reverse-coded"));
    expect(onChange).toHaveBeenCalledWith({ reverseCoded: true });
  });

  // §30: an AI-suggested item stays labelled until the researcher confirms it.
  it("keeps an AI-suggested item marked until it is confirmed", async () => {
    const { onChange } = setup({
      item: item({ id: "q-a", item_provenance: "ai_suggested", construct_id: "con-a", indicator_id: null }),
    });
    expect(screen.getByText(/AI suggested/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Measurement details" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm as mine" }));
    expect(onChange).toHaveBeenCalledWith({ itemProvenance: "user" });
  });

  it("cannot ask for a mapping when the project has no constructs", async () => {
    setup({ constructs: [], onSuggestMapping: vi.fn() });
    await userEvent.click(screen.getByRole("button", { name: "Measurement details" }));
    expect(screen.getByRole("button", { name: "Suggest a mapping" })).toBeDisabled();
  });

  it("shows a mapping proposal with the model's own confidence, labelled as a suggestion", async () => {
    setup({
      onSuggestMapping: vi.fn(),
      suggestions: [
        { constructId: "con-a", indicatorId: "ind-a", confidence: "medium", rationale: "Asks about motivation." },
      ],
    });
    await userEvent.click(screen.getByRole("button", { name: "Measurement details" }));
    expect(screen.getByText("AI SUGGESTED")).toBeInTheDocument();
    expect(screen.getByText(/Confidence the model reported: medium/)).toBeInTheDocument();
  });

  it("says so when nothing fitted, rather than showing an empty list", async () => {
    setup({ onSuggestMapping: vi.fn(), suggestions: [] });
    await userEvent.click(screen.getByRole("button", { name: "Measurement details" }));
    expect(screen.getByText(/No mapping suggestion fitted/i)).toBeInTheDocument();
  });
});
