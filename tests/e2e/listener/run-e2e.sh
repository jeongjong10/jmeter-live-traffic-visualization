#!/bin/sh
# Runs the fixture without changing JMeter's installed lib/ext directory.
set -eu

fixture_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
module_dir=$(CDPATH= cd -- "$fixture_dir/.." && pwd)
workspace_dir=$(CDPATH= cd -- "$module_dir/.." && pwd)
java_home=/opt/homebrew/opt/openjdk@21
jmeter_bin=/opt/homebrew/bin/jmeter
jar_path="$module_dir/target/jmeter-backend-listener-0.1.0-SNAPSHOT.jar"
result_file="$fixture_dir/e2e-results.jtl"
log_file="$fixture_dir/e2e-jmeter.log"

test -x "$java_home/bin/java"
test -x "$jmeter_bin"

JAVA_HOME="$java_home" "$java_home/bin/java" -version
(cd "$module_dir" && JAVA_HOME="$java_home" mvn -q package)
rm -f "$result_file" "$log_file"

JAVA_HOME="$java_home" "$jmeter_bin" -n \
  -t "$fixture_dir/e2e-backend-listener.jmx" \
  -Juser.classpath="$jar_path" \
  -l "$result_file" -j "$log_file"

grep -F 'event-collector listener initialized' "$log_file"
grep -F 'event-collector batch delivered (reason=batch-size, events=1, status=2' "$log_file"
grep -F 'Local debug sample' "$result_file"
printf '%s\n' 'E2E fixture passed: listener loaded, one sample posted, and collector delivery observed.'
