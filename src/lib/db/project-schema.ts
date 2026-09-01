import { z } from "zod";
import { SECTION_CHAIN } from "./projects";

const PROJECT_LANGUAGES = ["km", "en"] as const;
const PROJECT_STATUSES = ["draft", "active", "completed", "archived"] as const;

export const createProjectSchema = z.object({
  title: z.string().min(1).max(500),
  language: z.enum(PROJECT_LANGUAGES).optional(),
  discipline: z.string().max(200).optional(),
  study_design: z.string().max(200).optional(),
  target_population: z.array(z.string().max(200)).max(20).optional(),
  location: z.string().max(200).optional(),
  sample_size: z.number().int().positive().optional(),
  sampling_method: z.string().max(200).optional(),
});

export const updateProjectSchema = createProjectSchema.partial().extend({
  status: z.enum(PROJECT_STATUSES).optional(),
});

export const sectionTypeSchema = z.enum(
  SECTION_CHAIN as [(typeof SECTION_CHAIN)[number], ...(typeof SECTION_CHAIN)[number][]],
);

export const upsertSectionSchema = z.object({
  content: z.string().max(200_000).optional(),
  status: z.enum(["not_started", "in_progress", "completed"]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
