/**
 * Hand-written types mirroring supabase/migrations/*_phase2_*.sql. If the
 * Supabase CLI is linked to a project later, `supabase gen types typescript`
 * can regenerate a canonical version of this file from the live schema —
 * until then, keep this in sync with the migrations by hand.
 */

export type ProjectLanguage = "km" | "en";
export type ProjectStatus = "draft" | "active" | "completed" | "archived";

export type SectionType =
  | "title"
  | "research_problem"
  | "rationale"
  | "research_gap"
  | "objectives"
  | "research_questions"
  | "variables"
  | "conceptual_framework"
  | "methodology"
  | "questionnaire"
  | "data_collection"
  | "data_analysis"
  | "results"
  | "discussion"
  | "conclusion"
  | "recommendations"
  | "references"
  | "appendices";

/** The 18-section chain from Title through Appendices, in order (spec's opening requirement). */
export const SECTION_CHAIN: SectionType[] = [
  "title", "research_problem", "rationale", "research_gap",
  "objectives", "research_questions", "variables",
  "conceptual_framework", "methodology", "questionnaire",
  "data_collection", "data_analysis", "results", "discussion",
  "conclusion", "recommendations", "references", "appendices",
];

export const SECTION_LABELS: Record<SectionType, string> = {
  title: "Title",
  research_problem: "Research Problem",
  rationale: "Rationale",
  research_gap: "Research Gap",
  objectives: "Objectives",
  research_questions: "Research Questions",
  variables: "Variables",
  conceptual_framework: "Conceptual Framework",
  methodology: "Methodology",
  questionnaire: "Questionnaire / Instrument",
  data_collection: "Data Collection",
  data_analysis: "Data Analysis",
  results: "Results",
  discussion: "Discussion",
  conclusion: "Conclusion",
  recommendations: "Recommendations",
  references: "References",
  appendices: "Appendices",
};

export type SectionStatus = "not_started" | "in_progress" | "completed";

// ---------------------------------------------------------------------
// Evidence model (Phase 17)
// ---------------------------------------------------------------------

/**
 * Not every assertion needs a citation. `interpretive`, `user_provided` and
 * `inference` claims legitimately have none, and counting them against
 * evidence coverage would punish honest writing.
 */
export type ClaimType =
  | "factual"
  | "statistical"
  | "clinical"
  | "comparative"
  | "interpretive"
  | "user_provided"
  | "inference";

/** Never silently upgraded — see `deriveClaimStatus` for the only path to SUPPORTED. */
export type EvidenceStatusLabel =
  | "SUPPORTED"
  | "PARTIALLY_SUPPORTED"
  | "UNSUPPORTED"
  | "USER_PROVIDED"
  | "INFERENCE"
  | "NEEDS_VERIFICATION";

/** The judgement on one claim-evidence pair. Lives on the relation because the same excerpt can support one claim and not another. */
export type SupportLabel = "SUPPORTED" | "PARTIAL" | "UNSUPPORTED" | "NEEDS_REVIEW";

export interface ResearchClaimRow {
  id: string;
  project_id: string;
  section_type: SectionType;
  claim_text: string;
  claim_type: ClaimType;
  needs_evidence: boolean;
  evidence_status: EvidenceStatusLabel;
  source_offset_start: number | null;
  source_offset_end: number | null;
  created_at: string;
  updated_at: string;
}

export interface ResearchClaimInsert {
  project_id: string;
  section_type: SectionType;
  claim_text: string;
  claim_type?: ClaimType;
  needs_evidence?: boolean;
  evidence_status?: EvidenceStatusLabel;
  source_offset_start?: number | null;
  source_offset_end?: number | null;
}

export interface ResearchEvidenceRow {
  id: string;
  project_id: string;
  citation_id: string;
  document_id: string | null;
  chunk_id: string | null;
  excerpt: string;
  page: number | null;
  section_label: string | null;
  relevance_note: string | null;
  created_at: string;
}

export interface ResearchEvidenceInsert {
  project_id: string;
  citation_id: string;
  document_id?: string | null;
  chunk_id?: string | null;
  excerpt: string;
  page?: number | null;
  section_label?: string | null;
  relevance_note?: string | null;
}

export interface ResearchClaimEvidenceRow {
  id: string;
  project_id: string;
  claim_id: string;
  evidence_id: string;
  support: SupportLabel;
  note: string | null;
  inserted_into_section: SectionType | null;
  inserted_at: string | null;
  created_at: string;
}

export interface ResearchClaimEvidenceInsert {
  project_id: string;
  claim_id: string;
  evidence_id: string;
  support?: SupportLabel;
  note?: string | null;
  inserted_into_section?: SectionType | null;
  inserted_at?: string | null;
}

/** A framework node. `ai_suggested` survives editing around it, so provenance is not lost. */
export interface FrameworkNode {
  id: string;
  label: string;
  role: "population" | "exposure" | "mediator" | "outcome" | "covariate";
  ai_suggested: boolean;
}

export interface FrameworkEdge {
  id: string;
  from: string;
  to: string;
  rationale: string;
  ai_suggested: boolean;
}

export interface FrameworkGraph {
  nodes: FrameworkNode[];
  edges: FrameworkEdge[];
}

// ---------------------------------------------------------------------
// Literature workspace (Phase 17B)
// ---------------------------------------------------------------------

/** A researcher-owned grouping of sources. AI may propose one; only the researcher confirms it. */
export interface ResearchThemeRow {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  ai_suggested: boolean;
  /** False while an AI suggestion is still awaiting the researcher's confirmation (§22). */
  confirmed: boolean;
  created_at: string;
  updated_at: string;
}

export interface ResearchThemeInsert {
  project_id: string;
  name: string;
  description?: string | null;
  ai_suggested?: boolean;
  confirmed?: boolean;
}

export interface ResearchThemeSourceRow {
  id: string;
  project_id: string;
  theme_id: string;
  citation_id: string;
  ai_suggested: boolean;
  created_at: string;
}

/**
 * Where one field of a source profile came from. Null field text means "not
 * available in source" and is rendered as exactly that — never filled in.
 */
export type FieldProvenance = "source_stated" | "ai_inference" | "user_entered";

export const SOURCE_PROFILE_FIELDS = [
  "population",
  "study_design",
  "sample",
  "variables",
  "main_finding",
  "limitations",
  "relevance",
] as const;

export type SourceProfileField = (typeof SOURCE_PROFILE_FIELDS)[number];

export const SOURCE_PROFILE_FIELD_LABELS: Record<SourceProfileField, string> = {
  population: "Population",
  study_design: "Study design",
  sample: "Sample",
  variables: "Variables",
  main_finding: "Main finding",
  limitations: "Limitations",
  relevance: "Research relevance",
};

export interface ResearchSourceProfileRow {
  id: string;
  project_id: string;
  citation_id: string;
  population: string | null;
  study_design: string | null;
  sample: string | null;
  variables: string | null;
  main_finding: string | null;
  limitations: string | null;
  relevance: string | null;
  field_provenance: Partial<Record<SourceProfileField, FieldProvenance>>;
  created_at: string;
  updated_at: string;
}

export interface ResearchSourceProfileInsert {
  project_id: string;
  citation_id: string;
  population?: string | null;
  study_design?: string | null;
  sample?: string | null;
  variables?: string | null;
  main_finding?: string | null;
  limitations?: string | null;
  relevance?: string | null;
  field_provenance?: Partial<Record<SourceProfileField, FieldProvenance>>;
}

/**
 * How a gap is known. An inference never becomes a stated fact by being
 * stored — the basis travels with the row and is shown wherever the gap is
 * (§24).
 */
export type GapBasis =
  | "source_stated"
  | "derived_limitation"
  | "ai_inference"
  | "user_observation"
  | "needs_verification";

export const GAP_BASIS_LABELS: Record<GapBasis, string> = {
  source_stated: "Stated by source",
  derived_limitation: "Derived from a stated limitation",
  ai_inference: "AI inference",
  user_observation: "Your observation",
  needs_verification: "Needs verification",
};

export interface ResearchGapRow {
  id: string;
  project_id: string;
  citation_id: string | null;
  gap_text: string;
  basis: GapBasis;
  supporting_text: string | null;
  verified: boolean;
  created_at: string;
  updated_at: string;
}

export interface ResearchGapInsert {
  project_id: string;
  citation_id?: string | null;
  gap_text: string;
  basis?: GapBasis;
  supporting_text?: string | null;
  verified?: boolean;
}

export interface ResearchFrameworkRow {
  id: string;
  project_id: string;
  graph: FrameworkGraph;
  created_at: string;
  updated_at: string;
}

export type DocumentType =
  | "thesis" | "article" | "guideline" | "questionnaire"
  | "dataset" | "reference" | "template" | "other";

export type ExtractionStatus = "pending" | "processing" | "completed" | "failed";

export type CitationStatus = "verified" | "source_required" | "user_provided" | "inference" | "unverified";

export type ChatRole = "user" | "assistant" | "system";

// ---------------------------------------------------------------------
// research_projects
// ---------------------------------------------------------------------
export interface ResearchProjectRow {
  id: string;
  user_id: string;
  title: string;
  language: ProjectLanguage;
  discipline: string | null;
  study_design: string | null;
  target_population: string[];
  location: string | null;
  sample_size: number | null;
  sampling_method: string | null;
  status: ProjectStatus;
  created_at: string;
  updated_at: string;
}

export interface ResearchProjectInsert {
  user_id: string;
  title: string;
  language?: ProjectLanguage;
  discipline?: string | null;
  study_design?: string | null;
  target_population?: string[];
  location?: string | null;
  sample_size?: number | null;
  sampling_method?: string | null;
  status?: ProjectStatus;
}

export type ResearchProjectUpdate = Partial<Omit<ResearchProjectInsert, "user_id">>;

// ---------------------------------------------------------------------
// research_sections
// ---------------------------------------------------------------------
export interface ResearchSectionRow {
  id: string;
  project_id: string;
  section_type: SectionType;
  content: string;
  status: SectionStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ResearchSectionInsert {
  project_id: string;
  section_type: SectionType;
  content?: string;
  status?: SectionStatus;
  metadata?: Record<string, unknown>;
}

export type ResearchSectionUpdate = Partial<Omit<ResearchSectionInsert, "project_id" | "section_type">>;

// ---------------------------------------------------------------------
// research_documents
// ---------------------------------------------------------------------
export interface ResearchDocumentRow {
  id: string;
  project_id: string;
  uploaded_by: string;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  document_type: DocumentType;
  extraction_status: ExtractionStatus;
  extracted_text: string | null;
  extraction_error: string | null;
  /** The source record this document is, if it has been identified. */
  citation_id: string | null;
  created_at: string;
}

export interface ResearchDocumentInsert {
  project_id: string;
  uploaded_by: string;
  file_name: string;
  storage_path: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  document_type?: DocumentType;
  citation_id?: string | null;
}

export type ResearchDocumentUpdate = Partial<
  Pick<
    ResearchDocumentRow,
    "extraction_status" | "extracted_text" | "extraction_error" | "document_type" | "citation_id"
  >
>;

// ---------------------------------------------------------------------
// research_citations
// ---------------------------------------------------------------------
export interface ResearchCitationRow {
  id: string;
  project_id: string;
  citation_key: string;
  title: string | null;
  authors: string[];
  year: number | null;
  journal: string | null;
  doi: string | null;
  /** Free text, same shape as `doi` — normalized on read via `normalizePmid`, never on write. */
  pmid: string | null;
  /** Free text, same shape as `doi` — normalized on read via `normalizeIsbn`, never on write. */
  isbn: string | null;
  url: string | null;
  source_type: string | null;
  tier: 1 | 2 | 3 | 4 | null;
  status: CitationStatus;
  created_at: string;
}

export interface ResearchCitationInsert {
  project_id: string;
  citation_key: string;
  title?: string | null;
  authors?: string[];
  year?: number | null;
  journal?: string | null;
  doi?: string | null;
  pmid?: string | null;
  isbn?: string | null;
  url?: string | null;
  source_type?: string | null;
  tier?: 1 | 2 | 3 | 4 | null;
  status?: CitationStatus;
}

export type ResearchCitationUpdate = Partial<Omit<ResearchCitationInsert, "project_id" | "citation_key">>;

// ---------------------------------------------------------------------
// document_chunks (Phase 3 — RAG)
// ---------------------------------------------------------------------
export interface DocumentChunkRow {
  id: string;
  document_id: string;
  project_id: string;
  chunk_index: number;
  content: string;
  token_count: number;
  page: number | null;
  section: string | null;
  embedding: number[];
  created_at: string;
}

export interface DocumentChunkInsert {
  document_id: string;
  project_id: string;
  chunk_index: number;
  content: string;
  token_count?: number;
  page?: number | null;
  section?: string | null;
  embedding: number[];
}

/** Row shape returned by the match_document_chunks() RPC — no embedding vector, no created_at (not needed for retrieval results). */
export interface ChunkSearchResult {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  page: number | null;
  section: string | null;
  /**
   * Citation key of the source this chunk's document was identified as, or
   * null when the document has not been linked to a `research_citations`
   * row. Null means "the model has nothing citable for this excerpt" — it
   * must never be substituted with a placeholder key, because
   * `verifyCitationKeys()` would then flag a key the model was handed.
   */
  citation_key: string | null;
  similarity: number;
}

// ---------------------------------------------------------------------
// ai_conversations / ai_messages
// ---------------------------------------------------------------------
export interface AIConversationRow {
  id: string;
  project_id: string;
  user_id: string;
  title: string | null;
  created_at: string;
}

export interface AIConversationInsert {
  project_id: string;
  user_id: string;
  title?: string | null;
}

export interface AIMessageRow {
  id: string;
  conversation_id: string;
  role: ChatRole;
  content: string;
  task_type: string | null;
  provider: "gemini" | "openai" | null;
  model: string | null;
  structured_data: unknown;
  created_at: string;
}

export interface AIMessageInsert {
  conversation_id: string;
  role: ChatRole;
  content: string;
  task_type?: string | null;
  provider?: "gemini" | "openai" | null;
  model?: string | null;
  structured_data?: unknown;
}

// ---------------------------------------------------------------------
// ai_usage
// ---------------------------------------------------------------------
export interface AIUsageRow {
  id: string;
  project_id: string;
  user_id: string | null;
  task_type: string;
  provider: "gemini" | "openai";
  model: string;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
  latency_ms: number | null;
  success: boolean;
  fallback: boolean;
  created_at: string;
}

export interface AIUsageInsert {
  project_id: string;
  user_id?: string | null;
  task_type: string;
  provider: "gemini" | "openai";
  model: string;
  input_tokens?: number;
  output_tokens?: number;
  estimated_cost_usd?: number;
  latency_ms?: number | null;
  success: boolean;
  fallback?: boolean;
}

// ---------------------------------------------------------------------
// research_instruments / questionnaire_questions (Phase 6)
// ---------------------------------------------------------------------
export type ValidationStatus = "validated" | "adapted" | "researcher_developed";
export type QuestionResponseType = "likert" | "multiple_choice" | "yes_no" | "open_text" | "numeric";

export interface ResearchInstrumentRow {
  id: string;
  project_id: string;
  name: string;
  validation_status: ValidationStatus;
  source_reference: string | null;
  adaptation_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResearchInstrumentInsert {
  project_id: string;
  name: string;
  validation_status?: ValidationStatus;
  source_reference?: string | null;
  adaptation_notes?: string | null;
}

export interface QuestionnaireQuestionRow {
  id: string;
  instrument_id: string;
  project_id: string;
  section_label: string;
  /**
   * The free-text mapping Phase 6 shipped, kept deliberately (Phase 18 §22).
   * Some projects have only this, and dropping it to make a foreign key look
   * tidy would delete the mapping they actually have.
   */
  objective_label: string | null;
  variable_label: string | null;
  construct: string | null;
  question_text: string;
  response_type: QuestionResponseType;
  options: string[] | null;
  required: boolean;
  order_index: number;
  created_at: string;

  // --- Phase 18 structured mapping ------------------------------------
  construct_id: string | null;
  indicator_id: string | null;
  scale_id: string | null;
  /** Explicit, never inferred from wording — a guess would flip the sign of a result. */
  reverse_coded: boolean;
  item_provenance: MethodologyProvenance;
  source_citation_id: string | null;
  source_location: string | null;
  /** Null unless the item genuinely came from a source; the DB requires the citation with it. */
  adaptation_type: ItemAdaptationType | null;
  updated_at: string;
}

export interface QuestionnaireQuestionInsert {
  instrument_id: string;
  project_id: string;
  section_label: string;
  objective_label?: string | null;
  variable_label?: string | null;
  construct?: string | null;
  question_text: string;
  response_type: QuestionResponseType;
  options?: string[] | null;
  required?: boolean;
  order_index: number;

  construct_id?: string | null;
  indicator_id?: string | null;
  scale_id?: string | null;
  reverse_coded?: boolean;
  item_provenance?: MethodologyProvenance;
  source_citation_id?: string | null;
  source_location?: string | null;
  adaptation_type?: ItemAdaptationType | null;
}

// ---------------------------------------------------------------------
// research_datasets (Phase 7 — Data Analysis)
// ---------------------------------------------------------------------
export type ColumnType = "numeric" | "categorical" | "text" | "date";

export interface ColumnSchema {
  name: string;
  type: ColumnType;
  missingCount: number;
}

export type DatasetRow = Record<string, string | number | null>;

export interface ResearchDatasetRow {
  id: string;
  project_id: string;
  uploaded_by: string;
  file_name: string;
  row_count: number;
  column_schema: ColumnSchema[];
  data: DatasetRow[];
  created_at: string;
}

export interface ResearchDatasetInsert {
  project_id: string;
  uploaded_by: string;
  file_name: string;
  row_count: number;
  column_schema: ColumnSchema[];
  data: DatasetRow[];
}

// ---------------------------------------------------------------------
// rate_limit_events (Phase 15 — API abuse prevention)
// ---------------------------------------------------------------------
export interface RateLimitEventRow {
  id: string;
  user_id: string;
  bucket: string;
  created_at: string;
}

// ---------------------------------------------------------------------
// idempotency_keys (Phase 15 — duplicate-write prevention)
// ---------------------------------------------------------------------
export interface IdempotencyKeyRow {
  id: string;
  user_id: string;
  route: string;
  key: string;
  status_code: number;
  response_body: unknown;
  created_at: string;
}

// ---------------------------------------------------------------------
// Methodology model (Phase 18)
//
// The structured half of the chain. The prose in `research_sections` stays
// canonical for the document; these rows are canonical for reasoning, and
// neither is derived from the other automatically (see
// docs/PHASE_18_METHODOLOGY_AUDIT.md §3).
// ---------------------------------------------------------------------

/** The same five words the rest of the app already uses for where something came from. */
export type MethodologyProvenance = "user" | "ai_suggested" | "source_stated" | "imported";

export const PROVENANCE_LABELS: Record<MethodologyProvenance, string> = {
  user: "Researcher",
  ai_suggested: "AI suggested",
  source_stated: "From source",
  imported: "Imported",
};

/**
 * Structural shape of a research question. `unclassified` is a real answer and
 * the default: a question the rules cannot place is not a bad question, and a
 * guessed shape would put a label the researcher never chose in front of every
 * later check.
 */
export type QuestionKind =
  | "descriptive" | "comparative" | "correlational" | "causal" | "exploratory" | "unclassified";

export const QUESTION_KIND_LABELS: Record<QuestionKind, string> = {
  descriptive: "Descriptive",
  comparative: "Comparative",
  correlational: "Correlational",
  causal: "Causal / intervention",
  exploratory: "Exploratory",
  unclassified: "Unclassified",
};

export interface ResearchQuestionRow {
  id: string;
  project_id: string;
  question_text: string;
  question_kind: QuestionKind;
  provenance: MethodologyProvenance;
  confirmed: boolean;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface ResearchQuestionInsert {
  project_id: string;
  question_text: string;
  question_kind?: QuestionKind;
  provenance?: MethodologyProvenance;
  confirmed?: boolean;
  order_index?: number;
}

export interface ResearchObjectiveRow {
  id: string;
  project_id: string;
  /** Null while the objective has no question yet — work in progress, not an error. */
  question_id: string | null;
  objective_text: string;
  provenance: MethodologyProvenance;
  confirmed: boolean;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface ResearchObjectiveInsert {
  project_id: string;
  question_id?: string | null;
  objective_text: string;
  provenance?: MethodologyProvenance;
  confirmed?: boolean;
  order_index?: number;
}

/**
 * The role a construct plays in the study. One table holds both the concept and
 * its role: a separate `variables` table would give the app two names for one
 * thing, which is the confusion the consistency engine exists to detect.
 */
export type ConstructRole =
  | "independent" | "dependent" | "mediator" | "moderator" | "control" | "demographic" | "latent";

export const CONSTRUCT_ROLE_LABELS: Record<ConstructRole, string> = {
  independent: "Independent variable",
  dependent: "Dependent variable",
  mediator: "Mediator",
  moderator: "Moderator",
  control: "Control variable",
  demographic: "Demographic variable",
  latent: "Construct (no role assigned)",
};

export interface ResearchConstructRow {
  id: string;
  project_id: string;
  name: string;
  role: ConstructRole;
  /** What the concept means. */
  conceptual_definition: string | null;
  /** How it will be observed. Separate from the above because having the first
   *  and not the second is the most common measurement gap there is. */
  operational_definition: string | null;
  notes: string | null;
  provenance: MethodologyProvenance;
  confirmed: boolean;
  created_at: string;
  updated_at: string;
}

export interface ResearchConstructInsert {
  project_id: string;
  name: string;
  role?: ConstructRole;
  conceptual_definition?: string | null;
  operational_definition?: string | null;
  notes?: string | null;
  provenance?: MethodologyProvenance;
  confirmed?: boolean;
}

export interface ResearchIndicatorRow {
  id: string;
  project_id: string;
  construct_id: string;
  name: string;
  /** A grouping label under the construct — a column, not a table. */
  dimension: string | null;
  description: string | null;
  provenance: MethodologyProvenance;
  confirmed: boolean;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface ResearchIndicatorInsert {
  project_id: string;
  construct_id: string;
  name: string;
  dimension?: string | null;
  description?: string | null;
  provenance?: MethodologyProvenance;
  confirmed?: boolean;
  order_index?: number;
}

export type HypothesisForm =
  | "association" | "prediction" | "difference" | "mediation" | "moderation" | "descriptive" | "unclassified";

export const HYPOTHESIS_FORM_LABELS: Record<HypothesisForm, string> = {
  association: "Association",
  prediction: "Prediction",
  difference: "Group difference",
  mediation: "Mediation",
  moderation: "Moderation",
  descriptive: "Descriptive",
  unclassified: "Unclassified",
};

/** `unspecified` is the default and is not a defect — "X is associated with Y"
 *  states no direction, and recording one would put words in the study's mouth. */
export type HypothesisDirection = "positive" | "negative" | "none" | "unspecified";

export interface ResearchHypothesisRow {
  id: string;
  project_id: string;
  objective_id: string | null;
  question_id: string | null;
  /** The researcher's own numbering — "H1", "H2a". */
  label: string | null;
  statement: string;
  hypothesis_form: HypothesisForm;
  direction: HypothesisDirection;
  analysis_method: string | null;
  provenance: MethodologyProvenance;
  confirmed: boolean;
  order_index: number;
  created_at: string;
  updated_at: string;
}

export interface ResearchHypothesisInsert {
  project_id: string;
  objective_id?: string | null;
  question_id?: string | null;
  label?: string | null;
  statement: string;
  hypothesis_form?: HypothesisForm;
  direction?: HypothesisDirection;
  analysis_method?: string | null;
  provenance?: MethodologyProvenance;
  confirmed?: boolean;
  order_index?: number;
}

/** Where a construct sits in one hypothesis. A property of the relationship:
 *  the same construct is the outcome in H1 and the predictor in H2. */
export type HypothesisPosition = "predictor" | "outcome" | "mediator" | "moderator" | "control";

export const HYPOTHESIS_POSITION_LABELS: Record<HypothesisPosition, string> = {
  predictor: "Predictor",
  outcome: "Outcome",
  mediator: "Mediator",
  moderator: "Moderator",
  control: "Control",
};

export interface ResearchHypothesisVariableRow {
  id: string;
  project_id: string;
  hypothesis_id: string;
  construct_id: string;
  position: HypothesisPosition;
  provenance: MethodologyProvenance;
  created_at: string;
}

export interface ResearchHypothesisVariableInsert {
  project_id: string;
  hypothesis_id: string;
  construct_id: string;
  position: HypothesisPosition;
  provenance?: MethodologyProvenance;
}

export interface ScalePoint {
  value: number;
  label: string;
}

/** Which end of the scale is the high end, so reverse-coding can be checked
 *  rather than assumed. */
export type ScalePolarity = "ascending" | "descending" | "unordered";

export interface ResearchScaleRow {
  id: string;
  project_id: string;
  name: string;
  points: ScalePoint[];
  polarity: ScalePolarity;
  created_at: string;
  updated_at: string;
}

export interface ResearchScaleInsert {
  project_id: string;
  name: string;
  points?: ScalePoint[];
  polarity?: ScalePolarity;
}

/** How an item relates to the source it came from. Null unless it came from one. */
export type ItemAdaptationType = "verbatim" | "adapted" | "translated" | "inspired_by";

export const ADAPTATION_TYPE_LABELS: Record<ItemAdaptationType, string> = {
  verbatim: "Used verbatim",
  adapted: "Adapted",
  translated: "Translated",
  inspired_by: "Inspired by",
};

export type MethodologyEntityType =
  | "research_question" | "objective" | "construct" | "indicator" | "hypothesis"
  | "hypothesis_variable" | "scale" | "questionnaire_item" | "framework" | "review"
  // Phase 20. The legacy "framework" value refers to the whole jsonb graph;
  // these two name a single node or relationship, which is what a researcher
  // actually acts on. Reusing this log rather than adding a framework-specific
  // one keeps an afternoon's decisions reconstructable from one place.
  | "framework_node" | "framework_relationship";

export type MethodologyEventAction =
  | "created" | "updated" | "deleted" | "mapped" | "unmapped" | "restored"
  | "ai_suggestion_accepted" | "ai_suggestion_rejected" | "review_run";

/**
 * One entry in the append-only methodology audit. Carries the proposal, the
 * researcher's action and the value actually written, so "what was I offered
 * and what did I decide" is reconstructable (§23).
 */
export interface MethodologyEventRow {
  id: string;
  project_id: string;
  entity_type: MethodologyEntityType;
  /** Not a foreign key: history must survive the deletion of what it describes. */
  entity_id: string | null;
  action: MethodologyEventAction;
  summary: string;
  proposal: Record<string, unknown> | null;
  previous_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  created_at: string;
}

export interface MethodologyEventInsert {
  project_id: string;
  entity_type: MethodologyEntityType;
  entity_id?: string | null;
  action: MethodologyEventAction;
  summary: string;
  proposal?: Record<string, unknown> | null;
  previous_value?: Record<string, unknown> | null;
  new_value?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------
// Research integrity model (Phase 19)
// ---------------------------------------------------------------------

/**
 * A claim, traced to the single methodology node it is about. Exactly one
 * target column is set — enforced by a check constraint, not by convention —
 * mirroring how `questionnaire_questions` links to `construct_id` /
 * `indicator_id` / `scale_id`.
 */
export interface ResearchClaimMethodologyLinkRow {
  id: string;
  project_id: string;
  claim_id: string;
  construct_id: string | null;
  hypothesis_id: string | null;
  indicator_id: string | null;
  objective_id: string | null;
  question_id: string | null;
  note: string | null;
  created_at: string;
}

export interface ResearchClaimMethodologyLinkInsert {
  project_id: string;
  claim_id: string;
  construct_id?: string | null;
  hypothesis_id?: string | null;
  indicator_id?: string | null;
  objective_id?: string | null;
  question_id?: string | null;
  note?: string | null;
}

/**
 * A researcher's disposition of one derived finding. Findings themselves are
 * never stored — a finding id is a computed string, recomputed on every
 * review — but the decision about it must survive the next recompute.
 */
export type IntegrityDecisionStatus = "open" | "reviewing" | "accepted" | "dismissed" | "resolved_manually";

export interface ResearchIntegrityDecisionRow {
  id: string;
  project_id: string;
  finding_id: string;
  status: IntegrityDecisionStatus;
  note: string | null;
  actor_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResearchIntegrityDecisionInsert {
  project_id: string;
  finding_id: string;
  status?: IntegrityDecisionStatus;
  note?: string | null;
  actor_id?: string | null;
}

export type ResearchIntegrityDecisionUpdate = Partial<
  Pick<ResearchIntegrityDecisionInsert, "status" | "note">
>;

export type IntegrityEntityType =
  | "claim" | "citation" | "evidence" | "source" | "reference" | "methodology" | "finding" | "review";

export type IntegrityEventAction =
  | "integrity_review" | "finding_reviewed" | "finding_dismissed" | "citation_changed"
  | "evidence_linked" | "claim_reclassified" | "reference_merged" | "reference_unmerged";

/** One entry in the append-only integrity audit, same shape as `MethodologyEventRow`. */
export interface ResearchIntegrityEventRow {
  id: string;
  project_id: string;
  entity_type: IntegrityEntityType;
  /** Not a foreign key: history must survive the deletion of what it describes. */
  entity_id: string | null;
  action: IntegrityEventAction;
  summary: string;
  proposal: Record<string, unknown> | null;
  previous_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  created_at: string;
}

export interface ResearchIntegrityEventInsert {
  project_id: string;
  entity_type: IntegrityEntityType;
  entity_id?: string | null;
  action: IntegrityEventAction;
  summary: string;
  proposal?: Record<string, unknown> | null;
  previous_value?: Record<string, unknown> | null;
  new_value?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------
// Conceptual framework, bound to canonical constructs (Phase 20)
//
// The Phase 17 `FrameworkGraph`/`ResearchFrameworkRow` types above are the
// legacy jsonb shape and are deliberately left in place: §40 requires
// existing free-text framework data to stay safe and unmapped until a
// researcher decides, so nothing converts one into the other automatically.
// ---------------------------------------------------------------------

/**
 * A node has no `role` of its own. The role a concept plays is on
 * `research_constructs`, and repeating it here would let a node and its
 * construct disagree about what the study says — the second source of truth
 * §2.3 forbids. Role is read through `construct_id`.
 */
export interface ResearchFrameworkNodeRow {
  id: string;
  project_id: string;
  /** Null means unmapped: a legacy or in-progress node awaiting a decision. */
  construct_id: string | null;
  /** Presentation text. Kept beside a linked construct so mapping a legacy
   *  node does not lose its original wording; the construct's name is what
   *  every check reads. */
  label: string | null;
  /** Layout only (§10). No check, finding or metric may read these. */
  position_x: number;
  position_y: number;
  provenance: MethodologyProvenance;
  confirmed: boolean;
  created_at: string;
  updated_at: string;
}

export interface ResearchFrameworkNodeInsert {
  project_id: string;
  construct_id?: string | null;
  label?: string | null;
  position_x?: number;
  position_y?: number;
  provenance?: MethodologyProvenance;
  confirmed?: boolean;
}

export interface ResearchFrameworkNodeUpdate {
  construct_id?: string | null;
  label?: string | null;
  position_x?: number;
  position_y?: number;
  confirmed?: boolean;
}

/**
 * §7's vocabulary, and no more. Each word corresponds to something the
 * Phase 18 model can already justify — `mediates`/`moderates` to construct
 * roles, `predicts`/`influences` to directional hypotheses — and
 * `associated_with` is the non-directional default for a relationship the
 * researcher does not want to overclaim.
 */
export type FrameworkRelationType =
  | "predicts" | "influences" | "mediates" | "moderates" | "associated_with" | "supports";

export const FRAMEWORK_RELATION_LABELS: Record<FrameworkRelationType, string> = {
  predicts: "predicts",
  influences: "influences",
  mediates: "mediates",
  moderates: "moderates",
  associated_with: "is associated with",
  supports: "supports",
};

/** The relation types that assert a direction, so reversing the endpoints
 *  changes what is claimed. `associated_with` does not, which is why a
 *  direction mismatch against a hypothesis is only reported for these. */
export const DIRECTIONAL_RELATION_TYPES: readonly FrameworkRelationType[] = [
  "predicts", "influences", "mediates", "moderates", "supports",
];

/**
 * `hypothesis_id` belongs to the relationship, not to either node: a
 * hypothesis is a statement about a *pair* of constructs. Same shape as
 * `ResearchHypothesisVariableRow` (position held by the link) and
 * `ResearchClaimEvidenceRow` (support held by the link).
 */
export interface ResearchFrameworkRelationshipRow {
  id: string;
  project_id: string;
  from_node_id: string;
  to_node_id: string;
  relation_type: FrameworkRelationType;
  /** Null when the relationship is drawn but not yet tied to a hypothesis, or
   *  when the hypothesis it named was deleted. */
  hypothesis_id: string | null;
  rationale: string | null;
  provenance: MethodologyProvenance;
  confirmed: boolean;
  created_at: string;
  updated_at: string;
}

export interface ResearchFrameworkRelationshipInsert {
  project_id: string;
  from_node_id: string;
  to_node_id: string;
  relation_type?: FrameworkRelationType;
  hypothesis_id?: string | null;
  rationale?: string | null;
  provenance?: MethodologyProvenance;
  confirmed?: boolean;
}

export interface ResearchFrameworkRelationshipUpdate {
  relation_type?: FrameworkRelationType;
  hypothesis_id?: string | null;
  rationale?: string | null;
  confirmed?: boolean;
}
