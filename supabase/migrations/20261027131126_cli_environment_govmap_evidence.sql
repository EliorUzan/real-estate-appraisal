-- Environment CLI already freezes validated GovMap observations in plot_evidence.
-- The older plot-only check rejected these requests before a job was admitted.
-- Retain the existing object/size bound and plot behavior; allow only the
-- supported browser-evidence discriminator for the CLI environment section.
set local lock_timeout = '5s';

alter table public.generation_jobs
  drop constraint generation_jobs_check2,
  add constraint generation_jobs_govmap_evidence_check check (
    plot_evidence is null or (
      jsonb_typeof(plot_evidence) = 'object'
      and octet_length(plot_evidence::text) <= 6000000
      and (
        section_id = 'plot_description'
        or (
          section_id = 'environment_description'
          and execution_mode = 'cli'
          and plot_evidence @> '{"kind":"govmap_environment","collectionMethod":"domain_browser_sdk"}'::jsonb
        )
      )
    )
  );
