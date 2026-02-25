-- OPTIONAL FOR LOCAL SELF-HOSTED POSTGRES ONLY.
-- Do not run on managed Replit/Neon/Supabase environments.
-- Requires privileges to create roles and databases.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'onboarding_app') THEN
    CREATE ROLE onboarding_app LOGIN PASSWORD 'onboarding_app_dev_password';
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'onboarding') THEN
    CREATE DATABASE onboarding OWNER onboarding_app;
  END IF;
END
$$;
