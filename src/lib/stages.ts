// The production stages and which pile each one takes balls from and adds them to.
// Shared by the daily sheet (browser) and the save action (server).
// KEEP IN SYNC with the stage_flow view in drizzle/0001_stock_views.sql.

export type StageId =
  | "cutting"
  | "hand_quarter_stitching" | "hand_closing" | "hand_seam_stitching"
  | "machine_quarter_stitching" | "machine_stitching" | "machine_closing_seam";
export type Workflow = "hand" | "machine";
export type Construction = "4pc" | "2pc";
export type Buffer = "cut" | "cups" | "machine_stitched" | "closed" | "awaiting_grading";

export type StageDef = {
  id: StageId;
  name: string;
  what: string;
  workflow: Workflow | null; // null = shared by both (cutting)
  only4pc?: boolean;
  takesFrom: (c: Construction) => Buffer | null;
  addsTo: Buffer;
};

export const STAGES: StageDef[] = [
  { id: "cutting", name: "Leather cutting", what: "Sheets cut into quarters or cups", workflow: null, takesFrom: () => null, addsTo: "cut" },
  { id: "hand_quarter_stitching", name: "Quarter stitching", what: "Quarters stitched into cups by hand", workflow: "hand", only4pc: true, takesFrom: () => "cut", addsTo: "cups" },
  { id: "hand_closing", name: "Closing", what: "Cups closed around the cork core", workflow: "hand", takesFrom: (c) => (c === "4pc" ? "cups" : "cut"), addsTo: "closed" },
  { id: "hand_seam_stitching", name: "Seam stitching", what: "Main seam stitched by hand", workflow: "hand", takesFrom: () => "closed", addsTo: "awaiting_grading" },
  { id: "machine_quarter_stitching", name: "Quarter stitching", what: "Quarters stitched into cups", workflow: "machine", only4pc: true, takesFrom: () => "cut", addsTo: "cups" },
  { id: "machine_stitching", name: "Machine stitching", what: "Cups stitched on the machine", workflow: "machine", takesFrom: (c) => (c === "4pc" ? "cups" : "cut"), addsTo: "machine_stitched" },
  { id: "machine_closing_seam", name: "Closing and seam", what: "Cups closed around the cork core and the seam stitched", workflow: "machine", takesFrom: () => "machine_stitched", addsTo: "awaiting_grading" },
];

export const STAGE_BY_ID = Object.fromEntries(STAGES.map((s) => [s.id, s])) as Record<StageId, StageDef>;

export const WORKFLOWS: { id: Workflow; name: string }[] = [
  { id: "hand", name: "Hand stitched" },
  { id: "machine", name: "Machine stitched" },
];

export const BUFFER_LABEL: Record<Buffer, string> = {
  cut: "Cut leather",
  cups: "Cups",
  machine_stitched: "Machine stitched",
  closed: "Closed",
  awaiting_grading: "Waiting for grading",
};

export function stageAppliesTo(stage: StageDef, type: { workflow: Workflow; construction: Construction }) {
  return (!stage.workflow || stage.workflow === type.workflow) && (!stage.only4pc || type.construction === "4pc");
}

export const stagesOf = (w: Workflow) => STAGES.filter((s) => s.workflow === w);
