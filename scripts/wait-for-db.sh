#!/bin/sh
# Wait for database to be ready before starting the application

set -e

# Parse DATABASE_URL to get connection details
DB_HOST=$(echo $DATABASE_URL | sed 's/.*@\([^:]*\):.*/\1/')
DB_PORT=$(echo $DATABASE_URL | sed 's/.*:\([0-9]*\)\/.*/\1/')

echo "Waiting for database at $DB_HOST:$DB_PORT..."

# Wait for database to accept connections
until nc -z "$DB_HOST" "$DB_PORT"; do
  echo "Database is unavailable - sleeping"
  sleep 2
done

echo "Database is up - executing command"

# Run the initialization script to ensure required tables exist
echo "Checking database schema..."
node scripts/ensure-schema.js || echo "Schema check completed"

# Execute the command passed to this script
exec "$@"