-- Creates this service's own role and database on any PostgreSQL 16+ server: local Docker, a
-- managed host or your own. Run once, as a role allowed to create roles and databases:
--
--   psql "$ADMIN_DATABASE_URL" -v password="$(openssl rand -base64 24)" -f db/bootstrap.sql
--
-- Then set DATABASE_URL=postgres://openrms_rigs:<password>@<host>/openrms_rigs (add ?sslmode=verify-full for
-- a remote server) and start the service: migrations run at startup. The role owns only its own
-- database and cannot connect to other services' databases. Rename freely; nothing else depends
-- on these names.
\set ON_ERROR_STOP on
CREATE ROLE openrms_rigs LOGIN PASSWORD :'password';
-- Managed Postgres hosts run this as a non-superuser admin. On PostgreSQL 16+ it must be
-- a member of the role to create a database owned by it.
GRANT openrms_rigs TO CURRENT_USER;
CREATE DATABASE openrms_rigs OWNER openrms_rigs;
REVOKE ALL ON DATABASE openrms_rigs FROM PUBLIC;
