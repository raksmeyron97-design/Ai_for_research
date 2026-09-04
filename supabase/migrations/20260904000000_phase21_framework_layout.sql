-- Phase 21 §13-§16: researcher-editable framework layout.
--
-- Phase 20 stored `position_x` / `position_y` on every node and left them at
-- their defaults: the interface never wrote them and the list was ordered by
-- `created_at`, so "the framework has an order" meant "the order you happened
-- to add things in". §13 asks for reorderable nodes whose layout is
-- preserved, and this is the write path for that.
--
-- Why a function rather than a PATCH per node.
--
-- Reordering a list of n nodes through the existing item route is n HTTP
-- requests, each its own transaction. Three things go wrong with that, and
-- all three are the failure modes §36 and §50 name:
--
--   * it is not atomic. A reorder that fails at request 4 of 7 leaves the
--     framework in an order the researcher never asked for and cannot name.
--   * it races. Two tabs reordering the same list interleave into a third
--     order belonging to neither.
--   * it writes n audit events for one researcher action, so the history
--     reads as seven edits instead of "reordered the framework".
--
-- One statement fixes all three: the whole new order is applied or none of
-- it is.
--
-- SECURITY INVOKER (the default -- deliberately no `security definer`), like
-- `search_project_sources`. The caller's RLS decides which nodes are visible
-- and writable; `p_project_id` is the query, not the barrier. A caller who
-- names another project's nodes updates zero rows and gets the mismatch
-- exception below rather than a silent partial success.
--
-- §15: coordinates are presentation data. Nothing in validation.ts,
-- cross-system.ts or any metric reads position_x/position_y, and this
-- function changes nothing else -- so reordering the diagram cannot change
-- what the study claims.

create function reorder_framework_nodes(p_project_id uuid, p_node_ids uuid[])
returns setof research_framework_nodes
language plpgsql
as $$
declare
  v_expected integer;
  v_updated integer;
begin
  if p_node_ids is null or array_length(p_node_ids, 1) is null then
    raise exception 'reorder_framework_nodes: no nodes given'
      using errcode = 'invalid_parameter_value';
  end if;

  -- A duplicate id would give one node two positions. `update ... from` picks
  -- one of the matching rows arbitrarily rather than erroring, so the result
  -- would be a silently wrong order -- refuse it here instead.
  if (select count(distinct id) from unnest(p_node_ids) as id) <> array_length(p_node_ids, 1) then
    raise exception 'reorder_framework_nodes: duplicate node id in the requested order'
      using errcode = 'invalid_parameter_value';
  end if;

  -- The array must name every node in the project, exactly once. A partial
  -- order is not a smaller reorder: the nodes left out keep positions from
  -- the previous ordering and interleave unpredictably with the new one.
  -- Counting under the caller's RLS, so "the project's nodes" means the ones
  -- they can actually see.
  select count(*) into v_expected
    from research_framework_nodes
   where project_id = p_project_id;

  if v_expected <> array_length(p_node_ids, 1) then
    raise exception 'reorder_framework_nodes: expected % node id(s), got %',
      v_expected, array_length(p_node_ids, 1)
      using errcode = 'invalid_parameter_value';
  end if;

  -- Spaced by 100 rather than 1, so a future "insert between these two" has
  -- room to do it without renumbering the list.
  update research_framework_nodes n
     set position_y = (o.ord - 1) * 100,
         updated_at = now()
    from unnest(p_node_ids) with ordinality as o(node_id, ord)
   where n.id = o.node_id
     and n.project_id = p_project_id;

  get diagnostics v_updated = row_count;

  -- Belt and braces against the case the count check cannot see: an array
  -- that is the right length but names a node from another project (or one
  -- that RLS hides) in place of one of ours. That update touches fewer rows
  -- than the array has entries, and this turns it into a failed transaction
  -- rather than a partially applied order.
  if v_updated <> array_length(p_node_ids, 1) then
    raise exception 'reorder_framework_nodes: % of % node(s) were not in this project',
      array_length(p_node_ids, 1) - v_updated, array_length(p_node_ids, 1)
      using errcode = 'invalid_parameter_value';
  end if;

  return query
    select * from research_framework_nodes
     where project_id = p_project_id
     order by position_y, position_x, created_at, id;
end;
$$;

comment on function reorder_framework_nodes is
  'Applies a complete node order in one statement. SECURITY INVOKER: RLS decides what is writable. Presentation only -- no check or metric reads node coordinates.';

grant execute on function reorder_framework_nodes to authenticated;
