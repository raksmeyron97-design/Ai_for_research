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
}

export type ResearchDocumentUpdate = Partial<
  Pick<ResearchDocumentRow, "extraction_status" | "extracted_text" | "extraction_error" | "document_type">
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
