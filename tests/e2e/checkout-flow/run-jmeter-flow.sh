#!/bin/sh
# Starts only the mock API. The event collector must already be running on 127.0.0.1:8765.
set -eu

flow_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
workspace_dir=$(CDPATH= cd -- "$flow_dir/../../.." && pwd)
java_home=${JAVA_HOME:-}
jmeter_bin=${JMETER_BIN:-}
if test -z "$jmeter_bin"; then
  jmeter_bin=$(command -v jmeter 2>/dev/null || true)
fi
listener_jar="$workspace_dir/src/listener/target/jmeter-backend-listener-0.1.0-SNAPSHOT.jar"
log_dir="$workspace_dir/logs/e2e/checkout-flow"
mkdir -p "$log_dir"
results="$log_dir/checkout-results.jtl"
log_file="$log_dir/checkout-jmeter.log"
server_log="$log_dir/mock-api.log"
virtual_users=${VIRTUAL_USERS:-12}
ramp_up_seconds=${RAMP_UP_SECONDS:-2}
loops=${LOOPS:-2}

case "$virtual_users:$ramp_up_seconds:$loops" in
  *[!0-9:]*|:*|*::*) echo "VIRTUAL_USERS, RAMP_UP_SECONDS, and LOOPS must be positive integers." >&2; exit 64 ;;
esac
test "$virtual_users" -gt 0
test "$ramp_up_seconds" -gt 0
test "$loops" -gt 0
planned_journeys=$((virtual_users * loops))
settings_file=$(mktemp "$flow_dir/.load-settings.XXXXXX")

if test -n "$java_home"; then
  test -x "$java_home/bin/java"
fi
test -x "$jmeter_bin"
test -f "$listener_jar"
curl --fail --silent --show-error http://127.0.0.1:8765/api/snapshot >/dev/null
curl --fail --silent --show-error -X POST http://127.0.0.1:8765/api/reset >/dev/null
jq --argjson virtualUsers "$virtual_users" --argjson rampUpSeconds "$ramp_up_seconds" \
  --argjson loops "$loops" --argjson plannedJourneys "$planned_journeys" \
  '.virtualUsers=$virtualUsers | .rampUpSeconds=$rampUpSeconds | .loops=$loops | .plannedJourneys=$plannedJourneys' \
  "$flow_dir/load-settings.json" >"$settings_file"
curl --fail --silent --show-error -X POST -H 'Content-Type: application/json' \
  --data-binary "@$settings_file" http://127.0.0.1:8765/api/load-settings >/dev/null

python3 "$flow_dir/server.py" >"$server_log" 2>&1 &
mock_pid=$!
cleanup() { kill "$mock_pid" 2>/dev/null || true; wait "$mock_pid" 2>/dev/null || true; rm -f "$settings_file"; }
trap cleanup EXIT INT TERM

for _attempt in 1 2 3 4 5; do
  curl --fail --silent http://127.0.0.1:18081/health >/dev/null && break
  sleep 0.2
done
curl --fail --silent http://127.0.0.1:18081/health >/dev/null

rm -f "$results" "$log_file"
if test -n "$java_home"; then
  JAVA_HOME="$java_home" "$jmeter_bin" -n -t "$flow_dir/checkout-flow.jmx" \
    -Juser.classpath="$listener_jar" -JjourneyStartScript="$flow_dir/journey-start.groovy" \
    -JjourneySkipScript="$flow_dir/journey-skip-order.groovy" \
    -JvirtualUsers="$virtual_users" -JrampUpSeconds="$ramp_up_seconds" -Jloops="$loops" \
    -l "$results" -j "$log_file"
else
  "$jmeter_bin" -n -t "$flow_dir/checkout-flow.jmx" \
    -Juser.classpath="$listener_jar" -JjourneyStartScript="$flow_dir/journey-start.groovy" \
    -JjourneySkipScript="$flow_dir/journey-skip-order.groovy" \
    -JvirtualUsers="$virtual_users" -JrampUpSeconds="$ramp_up_seconds" -Jloops="$loops" \
    -l "$results" -j "$log_file"
fi

sample_count=$(( $(wc -l < "$results" | tr -d ' ') - 1 ))
failure_count=$(grep -F 'STEP:product-detail' "$results" | grep -F ',503,' | wc -l | tr -d ' ')
successful_detail_count=$((planned_journeys - failure_count))
expected_sample_count=$((planned_journeys * 4 + successful_detail_count * 3))
# Product-detail failures do not call cart, payment, or confirmation.
test "$sample_count" -eq "$expected_sample_count"
grep -F 'STEP:product-detail' "$results" >/dev/null
grep -F 'STEP:order-confirmation' "$results" >/dev/null
grep -F ',503,' "$results" >/dev/null
test "$(grep -F 'STEP:cart' "$results" | grep -F 'CORRELATION:checkout-t' | wc -l | tr -d ' ')" -eq "$successful_detail_count"
test "$(cut -d, -f3 "$results" | grep -o 'CORRELATION:[^|]*' | sort -u | wc -l | tr -d ' ')" -eq "$planned_journeys"
grep -F 'event-collector batch delivered' "$log_file" >/dev/null
printf '%s\n' "Seven-step commerce flow passed: ${sample_count} HTTP samples across ${virtual_users} virtual users x ${loops} rounds; ${failure_count} product-detail failures skip cart, payment, and order confirmation."
