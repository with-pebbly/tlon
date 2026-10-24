#!/bin/sh
# Project-local PostgreSQL cluster in ./.pgdata on port 54329 (no system service, no Docker).
# Requires PostgreSQL server binaries on PATH (e.g. `brew install postgresql@16`).
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGDATA="$ROOT/.pgdata"
PORT="${TLON_PG_PORT:-54329}"
USER_NAME=tlon
DB_NAME=tlon

case "${1:-}" in
start)
	if [ ! -f "$PGDATA/PG_VERSION" ]; then
		initdb -D "$PGDATA" -U "$USER_NAME" --auth=trust --encoding=UTF8 >/dev/null
	fi
	if pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
		echo "postgres already running on port $PORT"
	else
		pg_ctl -D "$PGDATA" -l "$PGDATA/server.log" -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1" -w start >/dev/null
		echo "postgres started on 127.0.0.1:$PORT"
	fi
	if ! psql -h 127.0.0.1 -p "$PORT" -U "$USER_NAME" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
		createdb -h 127.0.0.1 -p "$PORT" -U "$USER_NAME" "$DB_NAME"
		echo "database $DB_NAME created"
	fi
	;;
stop)
	pg_ctl -D "$PGDATA" -m fast stop
	;;
status)
	pg_ctl -D "$PGDATA" status
	;;
*)
	echo "usage: $0 start|stop|status" >&2
	exit 1
	;;
esac
