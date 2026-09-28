-- Tags are shown at the bottom of each stack, so anyone who can open a stack
-- can read its tags. The subquery runs under the stacks policy, so tags on
-- drafts, private stacks and stacks by blocked people stay hidden; authors
-- still read all of their own tags.

drop policy if exists "authors read their tags" on public.stack_tags;
create policy "tags are visible with their stack" on public.stack_tags for select
  using (exists (select 1 from public.stacks s where s.id = stack_id));

grant select on public.stack_tags to anon, authenticated;
