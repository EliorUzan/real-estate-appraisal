alter table public.generation_jobs drop constraint if exists generation_jobs_section_id_check;
alter table public.generation_jobs add constraint generation_jobs_section_id_check
  check (section_id in ('environment_description', 'plot_description'));

alter table public.agent_prompts drop constraint if exists agent_prompts_section_id_check;
alter table public.agent_prompts add constraint agent_prompts_section_id_check
  check (section_id in ('environment_description', 'plot_description', 'property_description', 'planning_status', 'registration_rights', 'comparable_sales', 'valuation_summary'));
