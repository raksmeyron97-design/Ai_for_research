-- Phase 3: dedicated column for extraction failure reasons, instead of
-- overloading extracted_text with an error message on failure (which
-- would make a failed document's "extracted text" preview show an error
-- string instead of being empty/null).

alter table research_documents
  add column extraction_error text;
