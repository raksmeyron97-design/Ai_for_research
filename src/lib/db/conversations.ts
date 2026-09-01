import type { SupabaseClient } from "@supabase/supabase-js";
import { toDbError } from "./errors";
import type { AIConversationInsert, AIConversationRow } from "./types";

const TABLE = "ai_conversations";

export async function getConversation(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<AIConversationRow | null> {
  const { data, error } = await supabase.from(TABLE).select("*").eq("id", conversationId).maybeSingle();
  if (error) throw toDbError(error, "getConversation");
  return data as AIConversationRow | null;
}

export async function createConversation(
  supabase: SupabaseClient,
  input: AIConversationInsert,
): Promise<AIConversationRow> {
  const { data, error } = await supabase.from(TABLE).insert(input).select("*").single();
  if (error) throw toDbError(error, "createConversation");
  return data as AIConversationRow;
}
