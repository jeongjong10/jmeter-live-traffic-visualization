#!/bin/sh
# Runs btoc-like.jmx (Backend Listener only, no journey scripts) and checks
# that the collector rebuilt every JMeter sample onto the registered plan.
# Usage: ./run.sh [continue|stoptest]   (collector must already be running)
# VIRTUAL_USERS (default 3) and ANSWER_COUNT (default 5) scale the KCAT thread
# group, e.g. VIRTUAL_USERS=30 ANSWER_COUNT=170 approximates a 30-user btoc run.
set -eu

mode=${1:-continue}
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root=$(CDPATH= cd -- "$here/../../.." && pwd)
jmeter_bin=${JMETER_BIN:-$(command -v jmeter 2>/dev/null || true)}
listener_jar="$root/src/listener/target/jmeter-backend-listener-0.1.0-SNAPSHOT.jar"
collector=http://127.0.0.1:8765
log_dir="$root/logs/e2e/btoc-like"
mkdir -p "$log_dir"
results="$log_dir/btoc-like-results.jtl"
users=${VIRTUAL_USERS:-3}
answers=${ANSWER_COUNT:-5}

test -x "$jmeter_bin" || { echo "Set JMETER_BIN to the jmeter executable." >&2; exit 64; }
test -f "$listener_jar" || { echo "Build the listener first: (cd src/listener && mvn package)" >&2; exit 64; }
curl --fail --silent "$collector/api/snapshot" >/dev/null || { echo "Start the collector first: (cd docker && docker compose up -d)" >&2; exit 64; }

case "$mode" in
  continue) on_error=continue ;;
  stoptest) on_error=stoptest ;;
  *) echo "mode must be continue or stoptest" >&2; exit 64 ;;
esac
# The edits below touch only the KCAT thread group (the first one in the file).
plan=$(mktemp "$here/.btoc-like-plan.XXXXXX")
answers_csv=$(mktemp "$here/.btoc-like-answers.XXXXXX")
sed -e "0,/<intProp name=\"ThreadGroup.num_threads\">3</s//<intProp name=\"ThreadGroup.num_threads\">$users</" \
    -e "0,/<stringProp name=\"ThreadGroup.on_sample_error\">continue</s//<stringProp name=\"ThreadGroup.on_sample_error\">$on_error</" \
    "$here/btoc-like.jmx" >"$plan"
seq 1 "$answers" | sed 's/^/q/' >"$answers_csv"

python3 "$here/server.py" >"$log_dir/mock-api.log" 2>&1 &
mock_pid=$!
cleanup() { kill "$mock_pid" 2>/dev/null || true; wait "$mock_pid" 2>/dev/null || true; rm -f "$plan" "$answers_csv"; }
trap cleanup EXIT INT TERM
for _attempt in 1 2 3 4 5 6 7 8 9 10; do curl --fail --silent http://127.0.0.1:18082/health >/dev/null && break; sleep 0.2; done

rm -f "$results"
"$jmeter_bin" -n -t "$plan" -Juser.classpath="$listener_jar" -JanswersCsv="$answers_csv" \
  -l "$results" -j "$log_dir/btoc-like-jmeter.log"
sleep 1

curl --fail --silent "$collector/api/recording" | python3 -I -c '
import csv, json, sys
mode, results, users, answers = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
events = json.load(sys.stdin)["events"]
journey = [e for e in events if e.get("eventType") == "journey"]
measured = [e for e in journey if e["phase"] in ("completed", "aborted")]
samples = list(csv.DictReader(open(results, encoding="utf-8")))
per_step = {}
for e in measured:
    per_step.setdefault(e["stepId"], []).append(e["phase"])
for step, phases in sorted(per_step.items(), key=lambda p: (p[0].split("-")[0], int(p[0].split("-s")[1]))):
    aborted = phases.count("aborted")
    print(f"  {step}: {len(phases)} measured, {aborted} aborted")
unmatched = sum(1 for e in events if e.get("unmatched"))
halted = [e for e in journey if e["phase"] == "halted"]
cancelled = [e for e in journey if e["phase"] == "cancelled"]
open_estimates = {e["requestId"] for e in journey if e["phase"] == "started"} - {e["requestId"] for e in measured + cancelled}
markers = [e["phase"] for e in events if e.get("eventType") == "test"]
print(f"JTL samples={len(samples)} measured={len(measured)} unmatched={unmatched} halted={len(halted)} cancelled={len(cancelled)} open-estimates={len(open_estimates)} test-markers={markers}")
assert len(measured) == len(samples), "every JMeter sample must map to a plan step"
assert unmatched == 0 and not open_estimates and markers == ["started", "ended"]
assert all(e["startedAt"] <= e["timestamp"] for e in measured)
if mode == "continue":
    assert len(per_step["tg1-s5"]) == users * answers and per_step["tg1-s7"].count("aborted") == 1 and not halted
    assert len(per_step["tg2-s1"]) == 6 and len({e["correlationId"] for e in measured if e["journeyId"] == "tg2"}) == 6
else:
    assert len(halted) == 1 and halted[0]["stepId"] == "tg1-s7" and halted[0]["outcome"] == "stoptest"
print(f"btoc-like {mode} flow passed.")
' "$mode" "$results" "$users" "$answers"
