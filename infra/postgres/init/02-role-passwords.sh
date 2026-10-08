#!/bin/sh
# Turn on LOGIN for the app roles created by 01-schemas-roles.sql, with passwords from .env.
# Runs once, when the postgres volume is first created (docker-entrypoint-initdb.d).
set -eu

: "${ACCOUNT_DB_PASSWORD:?set ACCOUNT_DB_PASSWORD in .env}"
: "${STUDIO_DB_PASSWORD:?set STUDIO_DB_PASSWORD in .env}"
: "${REPORTING_DB_PASSWORD:?set REPORTING_DB_PASSWORD in .env}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v account_pw="$ACCOUNT_DB_PASSWORD" \
  -v studio_pw="$STUDIO_DB_PASSWORD" \
  -v reporting_pw="$REPORTING_DB_PASSWORD" <<'SQL'
ALTER ROLE account_app LOGIN PASSWORD :'account_pw';
ALTER ROLE studio_app LOGIN PASSWORD :'studio_pw';
ALTER ROLE reporting_ro LOGIN PASSWORD :'reporting_pw';
SQL
