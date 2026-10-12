-- Database-native scheduling avoids another hosting service or shared worker token.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('appraisal-cli-maintenance','* * * * *','select public.cli_maintenance();');
