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
  objective_label: string | null;
  variable_label: string | null;
  construct: string | null;
  question_text: string;
  response_type: QuestionResponseType;
  options: string[] | null;
  required: boolean;
  order_index: number;
  created_at: string;
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
