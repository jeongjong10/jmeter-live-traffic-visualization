"""Unit tests for jmx plan parsing and listener-only journey reconstruction."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from flow_tracker import FlowTracker  # noqa: E402
from jmx_plan import parse_jmx, parse_test_tree  # noqa: E402
from run_store import RunStore  # noqa: E402


def sampler(name, path="/x", enabled="true"):
    return (f'<HTTPSamplerProxy testclass="HTTPSamplerProxy" testname="{name}" enabled="{enabled}">'
            f'<stringProp name="HTTPSampler.path">{path}</stringProp>'
            f'<stringProp name="HTTPSampler.method">GET</stringProp></HTTPSamplerProxy><hashTree/>')


def jmx(on_error="continue", loops="1"):
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan><hashTree>
<TestPlan testclass="TestPlan" testname="plan"/><hashTree>
<ThreadGroup testclass="ThreadGroup" testname="Journey TG">
  <intProp name="ThreadGroup.num_threads">2</intProp><intProp name="ThreadGroup.ramp_time">1</intProp>
  <stringProp name="ThreadGroup.on_sample_error">{on_error}</stringProp>
  <elementProp name="ThreadGroup.main_controller" elementType="LoopController">
    <stringProp name="LoopController.loops">{loops}</stringProp></elementProp>
</ThreadGroup><hashTree>
  {sampler("login")}
  {sampler("info")}
  <LoopController testclass="LoopController" testname="answers"><intProp name="LoopController.loops">-1</intProp></LoopController><hashTree>
    <IfController testclass="IfController" testname="eof"/><hashTree>
      <TestAction testclass="TestAction" testname="break"/><hashTree/>
    </hashTree>
    {sampler("answer")}
  </hashTree>
  {sampler("info")}
  {sampler("disabled", enabled="false")}
  {sampler("report")}
</hashTree>
<ThreadGroup testclass="ThreadGroup" testname="Off TG" enabled="false"/><hashTree>{sampler("x")}</hashTree>
</hashTree></hashTree></jmeterTestPlan>"""


def sample(label, start, elapsed=100, success=True, thread="Journey TG 1-1"):
    return {"threadName": thread, "label": label, "startTime": start, "timestamp": start + elapsed,
            "elapsed": elapsed, "success": success, "responseCode": "200" if success else "500"}


class JmxPlanTest(unittest.TestCase):
    def test_keeps_enabled_samplers_in_tree_order_and_marks_loops(self):
        plan = parse_jmx(jmx())
        self.assertEqual(1, len(plan["threadGroups"]))
        group = plan["threadGroups"][0]
        self.assertEqual(["login", "info", "answer", "info", "report"], [s["label"] for s in group["steps"]])
        self.assertEqual([False, False, True, False, False], [s["repeat"] for s in group["steps"]])
        self.assertEqual("tg1-s4", group["steps"][3]["id"])
        self.assertEqual((2, 1, 1, "continue"), (group["threads"], group["rampUpSeconds"], group["loops"], group["onSampleError"]))
        self.assertEqual((False, None, None, True, False), (group["scheduler"], group["durationSeconds"], group["startDelaySeconds"],
                                                            group["sameUserOnNextIteration"], group["delayedStart"]))
        self.assertEqual([], plan["warnings"])

    def test_reads_scheduler_and_thread_lifecycle_settings(self):
        source = jmx().replace('<stringProp name="ThreadGroup.on_sample_error">',
                               '<boolProp name="ThreadGroup.scheduler">true</boolProp><longProp name="ThreadGroup.duration">60</longProp>'
                               '<longProp name="ThreadGroup.delay">5</longProp><boolProp name="ThreadGroup.same_user_on_next_iteration">false</boolProp>'
                               '<boolProp name="ThreadGroup.delayedStart">true</boolProp><stringProp name="ThreadGroup.on_sample_error">')
        group = parse_jmx(source)["threadGroups"][0]
        self.assertEqual((True, 60, 5, False, True), (group["scheduler"], group["durationSeconds"], group["startDelaySeconds"],
                                                      group["sameUserOnNextIteration"], group["delayedStart"]))

    def test_warns_about_unsupported_elements(self):
        source = jmx().replace('<LoopController testclass="LoopController" testname="answers">',
                               '<SwitchController testclass="SwitchController" testname="sw">').replace(
            '</LoopController><hashTree>', '</SwitchController><hashTree>')
        self.assertEqual(1, len(parse_jmx(source)["warnings"]))


class FlowTrackerTest(unittest.TestCase):
    def setUp(self):
        self.tracker = FlowTracker()

    def run_samples(self, samples, on_error="continue", loops="1"):
        self.tracker.set_plan(parse_jmx(jmx(on_error, loops)))
        return [event for raw in samples for event in self.tracker.sample(raw)]

    def test_separates_duplicate_labels_and_repeats_by_position(self):
        events = self.run_samples([sample("login", 0), sample("info", 100), sample("answer", 200),
                                   sample("answer", 300), sample("info", 400), sample("report", 500)])
        done = [e for e in events if e["phase"] == "completed"]
        self.assertEqual(["tg1-s1", "tg1-s2", "tg1-s3", "tg1-s3", "tg1-s4", "tg1-s5"], [e["stepId"] for e in done])
        self.assertEqual({"Journey TG 1-1#1"}, {e["correlationId"] for e in done})

    def test_estimates_the_next_step_and_confirms_it_with_the_real_sample(self):
        events = self.run_samples([sample("login", 0, 100), sample("info", 105, 50)])
        started = [e for e in events if e["phase"] == "started"]
        self.assertEqual("tg1-s2", started[0]["stepId"])
        self.assertTrue(started[0]["estimated"])
        self.assertEqual(100, started[0]["startedAt"])
        confirmed = [e for e in events if e["phase"] == "completed" and e["stepId"] == "tg1-s2"][0]
        self.assertEqual(started[0]["requestId"], confirmed["requestId"])
        self.assertEqual(105, confirmed["startedAt"])
        self.assertFalse(confirmed["estimated"])

    def test_cancels_a_repeat_estimate_when_the_loop_ends(self):
        events = self.run_samples([sample("login", 0), sample("info", 100), sample("answer", 200), sample("info", 300)])
        cancelled = [e for e in events if e["phase"] == "cancelled"]
        self.assertEqual(["tg1-s3"], [e["stepId"] for e in cancelled])

    def test_keeps_the_failure_message_of_a_failed_sample(self):
        events = self.run_samples([{**sample("login", 0, success=False), "failureMessage": "Assertion: code != 0000"}])
        self.assertEqual("Assertion: code != 0000", events[0]["failureMessage"])

    def test_stop_policy_halts_without_estimating(self):
        events = self.run_samples([sample("login", 0), sample("info", 100, success=False)], on_error="stoptest")
        self.assertEqual(["started", "aborted", "halted"], [e["phase"] for e in events[1:]])

    def test_continue_policy_keeps_estimating_after_an_error(self):
        events = self.run_samples([sample("login", 0, success=False)])
        self.assertEqual(["aborted", "started"], [e["phase"] for e in events])

    def test_a_repeated_first_step_starts_the_next_iteration(self):
        events = self.run_samples([sample("login", 0), sample("report", 100), sample("login", 200)], loops="2")
        done = [e for e in events if e["phase"] == "completed"]
        self.assertEqual(["Journey TG 1-1#1", "Journey TG 1-1#1", "Journey TG 1-1#2"], [e["correlationId"] for e in done])

    def test_test_end_cancels_open_estimates(self):
        self.run_samples([sample("login", 0)])
        self.assertEqual(["cancelled"], [e["phase"] for e in self.tracker.end_test(500)])

    def test_ignores_threads_outside_the_plan(self):
        self.tracker.set_plan(parse_jmx(jmx()))
        self.assertFalse(self.tracker.handles(sample("login", 0, thread="Other TG 1-1")))
        self.assertFalse(self.tracker.handles({**sample("login", 0), "stepId": "auth"}))


class RunStoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "runs"

    def tearDown(self):
        self.tmp.cleanup()

    def test_keeps_the_five_newest_runs_with_their_plan(self):
        store = RunStore(self.root, keep=5)
        for start in range(1, 8):
            store.start(start * 1000, {"testPlan": f"plan {start}"})
            store.append({"phase": "completed", "timestamp": start * 1000 + 1}, None)
            store.append({"phase": "aborted", "timestamp": start * 1000 + 2}, None)
            store.end(start * 1000 + 3)
        summaries = store.summaries()
        self.assertEqual([7000, 6000, 5000, 4000, 3000], [row["startedAt"] for row in summaries])
        self.assertEqual((2, 1, "plan 7", True), (summaries[0]["samples"], summaries[0]["errors"], summaries[0]["testPlan"], summaries[0]["live"]))
        self.assertEqual("plan 3", store.meta(summaries[-1]["id"])["plan"]["testPlan"])

    def test_detach_keeps_the_run_and_resume_reopens_the_newest(self):
        store = RunStore(self.root)
        store.start(1000, None)
        store.append({"phase": "completed", "timestamp": 1001}, None)
        store.detach()
        store.append({"phase": "completed", "timestamp": 2000}, None)
        self.assertEqual(2, len(store.ids()))
        reopened = RunStore(self.root)
        self.assertEqual([{"phase": "completed", "timestamp": 2000}], reopened.resume_latest())
        self.assertEqual(2000, reopened.current["startedAt"])



class TestTreeTest(unittest.TestCase):
    def test_parses_the_live_listener_tree_like_a_jmx(self):
        tree = [
            {"tag": "TestPlan", "name": "plan", "enabled": True, "props": {}}, [
                {"tag": "ThreadGroup", "name": "Journey TG", "enabled": True, "props": {
                    "ThreadGroup.num_threads": "2",
                    "ThreadGroup.on_sample_error": "continue",
                    "ThreadGroup.main_controller": '{"tag": "LoopController", "name": "lc", "enabled": true, '
                        '"props": {"LoopController.loops": "1"}}'}}, [
                    {"tag": "HTTPSamplerProxy", "name": "login", "enabled": True,
                     "props": {"HTTPSampler.path": "/in", "HTTPSampler.method": "POST"}}, [],
                    {"tag": "LoopController", "name": "answers", "enabled": True,
                     "props": {"LoopController.loops": "-1"}}, [
                        {"tag": "CSVDataSet", "name": "csv", "enabled": True, "props": {}}, [],
                        {"tag": "HTTPSamplerProxy", "name": "answer", "enabled": True, "props": {}}, [],
                    ],
                    {"tag": "HTTPSamplerProxy", "name": "off", "enabled": False, "props": {}}, [],
                    {"tag": "HTTPSamplerProxy", "name": "report", "enabled": True, "props": {}}, [],
                ],
            ],
        ]
        group = parse_test_tree(tree)["threadGroups"][0]
        self.assertEqual(["login", "answer", "report"], [s["label"] for s in group["steps"]])
        self.assertEqual([False, True, False], [s["repeat"] for s in group["steps"]])
        self.assertEqual((2, 1, "continue"), (group["threads"], group["loops"], group["onSampleError"]))


if __name__ == "__main__":
    unittest.main()
