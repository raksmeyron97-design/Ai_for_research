import type { SupabaseClient } from "@supabase/supabase-js";
import { toDbError } from "./errors";
import type { AIMessageInsert, AIMessageRow } from "./types";

const TABLE = "ai_messages";

export async function insertMessage(
  supabase: SupabaseClient,
  input: AIMessageInsert,
): Promise<AIMessageRow> {
  const { data, error } = await supabase.from(TABLE).insert(input).select("*").single();
  if (error) throw toDbError(error, "insertMessage");
  return data as AIMessageRow;
}

/**
 * Most recent `limit` messages, returned oldest-first (chronological) —
 * the DB query needs `order(desc).limit(N)` to get the *most recent* N
 * rows, then this reverses that page back into reading order for
 * ContextManager's Layer 5.
 */
export async function getRecentMessages(
  supabase: SupabaseClient,
  conversationId: string,
  limit = 6,
): Promise<AIMessageRow[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw toDbError(error, "getRecentMessages");
  return (data as AIMessageRow[]).reverse();
}
