\set ON_ERROR_STOP on

-- Local Postgres bootstrap for onboarding app.
-- Run this script as a superuser (for example: postgres).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'onboarding_app') THEN
    CREATE ROLE onboarding_app LOGIN PASSWORD 'onboarding_app_dev_password';
  ELSE
    ALTER ROLE onboarding_app WITH LOGIN PASSWORD 'onboarding_app_dev_password';
  END IF;
END
$$;

SELECT 'CREATE DATABASE onboarding OWNER onboarding_app'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'onboarding')
\gexec

GRANT ALL PRIVILEGES ON DATABASE onboarding TO onboarding_app;

\connect onboarding

GRANT USAGE, CREATE ON SCHEMA public TO onboarding_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO onboarding_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO onboarding_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO onboarding_app;
