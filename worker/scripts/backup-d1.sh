#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_DIR="$(cd "${WORKER_DIR}/.." && pwd)"
BACKUP_DIR="${MINOVA_D1_BACKUP_DIR:-/Users/jqz/Documents/MINOVA PROFILE/01-Projects/MINOVA QUOTATION WEBSITE/backup}"
DATABASE_NAME="${MINOVA_D1_DATABASE_NAME:-minova-auth-db}"
TASK_SLUG="${1:-change}"
SAFE_SLUG="$(printf '%s' "${TASK_SLUG}" | tr '[:upper:] ' '[:lower:]-' | sed 's/[^a-z0-9._-]/-/g; s/-\{2,\}/-/g; s/^-//; s/-$//')"

if [[ -z "${SAFE_SLUG}" ]]; then
  SAFE_SLUG="change"
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BASE_SHA="$(git -C "${REPO_DIR}" rev-parse HEAD)"
SHORT_SHA="$(git -C "${REPO_DIR}" rev-parse --short=12 HEAD)"
SQL_PATH="${BACKUP_DIR}/${TIMESTAMP}-before-${SAFE_SLUG}-${SHORT_SHA}.sql"
MANIFEST_PATH="${SQL_PATH%.sql}.manifest.txt"
TEMP_SQL="$(mktemp "${TMPDIR:-/tmp}/minova-d1-export.XXXXXX")"

cleanup() {
  rm -f "${TEMP_SQL}"
}
trap cleanup EXIT

wait_for_stable_file() {
  local file_path="$1"
  local previous_signature=""
  local stable_reads=0
  local current_signature=""

  for _ in {1..30}; do
    current_signature="$(shasum -a 256 "${file_path}" | awk '{print $1}'):$(wc -c < "${file_path}" | tr -d ' ')"
    if [[ "${current_signature}" == "${previous_signature}" ]]; then
      stable_reads=$((stable_reads + 1))
    else
      stable_reads=0
      previous_signature="${current_signature}"
    fi
    if [[ "${stable_reads}" -ge 2 ]]; then
      return 0
    fi
    sleep 2
  done

  return 1
}

mkdir -p "${BACKUP_DIR}"

cd "${WORKER_DIR}"
npx wrangler d1 export "${DATABASE_NAME}" --remote --skip-confirmation --output "${TEMP_SQL}"

if [[ ! -s "${TEMP_SQL}" ]]; then
  echo "D1 backup is empty: ${TEMP_SQL}" >&2
  exit 1
fi

if ! wait_for_stable_file "${TEMP_SQL}"; then
  echo "D1 export did not reach a stable hash within 60 seconds: ${TEMP_SQL}" >&2
  exit 1
fi

cp "${TEMP_SQL}" "${SQL_PATH}"

if ! cmp -s "${TEMP_SQL}" "${SQL_PATH}"; then
  echo "D1 backup content differs after copying: ${SQL_PATH}" >&2
  exit 1
fi

SOURCE_SHA256="$(shasum -a 256 "${TEMP_SQL}" | awk '{print $1}')"
SQL_BYTES="$(wc -c < "${SQL_PATH}" | tr -d ' ')"
FIRST_LINE="$(head -n 1 "${SQL_PATH}")"
LAST_LINE="$(tail -n 1 "${SQL_PATH}")"
CREATE_TABLE_COUNT="$(grep -c '^CREATE TABLE' "${SQL_PATH}" || true)"
INSERT_COUNT="$(grep -c '^INSERT INTO' "${SQL_PATH}" || true)"

if [[ "${CREATE_TABLE_COUNT}" -eq 0 || "${LAST_LINE}" != *';' ]]; then
  echo "D1 backup SQL structure check failed: ${SQL_PATH}" >&2
  exit 1
fi

{
  printf 'database=%s\n' "${DATABASE_NAME}"
  printf 'created_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'task=%s\n' "${SAFE_SLUG}"
  printf 'pre_change_git_sha=%s\n' "${BASE_SHA}"
  printf 'sql_file=%s\n' "${SQL_PATH}"
  printf 'verification_method=%s\n' 'local_export_then_copy_cmp_and_sql_structure_check'
  printf 'source_tmp_sha256=%s\n' "${SOURCE_SHA256}"
  printf 'sql_bytes=%s\n' "${SQL_BYTES}"
  printf 'first_line=%s\n' "${FIRST_LINE}"
  printf 'last_line=%s\n' "${LAST_LINE}"
  printf 'create_table_statements=%s\n' "${CREATE_TABLE_COUNT}"
  printf 'insert_statements=%s\n' "${INSERT_COUNT}"
  printf 'verification_status=%s\n' 'valid'
} > "${MANIFEST_PATH}"

printf 'D1 backup: %s\n' "${SQL_PATH}"
printf 'Manifest: %s\n' "${MANIFEST_PATH}"
printf 'Source SHA-256: %s\n' "${SOURCE_SHA256}"
printf 'Pre-change Git SHA: %s\n' "${BASE_SHA}"
