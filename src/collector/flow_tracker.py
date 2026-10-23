"""Rebuilds per-user journeys from plain Backend Listener samples.

A JMeter thread sends its samplers one after another, so when one sample
completes the next step of the same thread has just started. The tracker
matches each sample to a plan step by label, searching forward from the
thread's last step (this separates duplicate labels by position), then emits:

- ``completed``/``aborted`` for the measured sample (real start and elapsed), and
- ``started`` with ``estimated: true`` for the step it expects next.

An estimate is confirmed by the next real sample for that step, or withdrawn
with ``cancelled`` when the thread goes elsewhere or the test ends.
"""
from __future__ import annotations

import re

THREAD_NAME = re.compile(r"^(?P<group>.+) (?P<group_no>\d+)-(?P<thread_no>\d+)$")
STOPPING_POLICIES = {"stopthread", "stoptest", "stoptestnow"}


class FlowTracker:
    def __init__(self) -> None:
        self.plan: dict | None = None
        self.groups: dict[str, dict] = {}
        self.reset()

    def reset(self) -> None:
        self.threads: dict[str, dict] = {}

    def set_plan(self, plan: dict | None) -> None:
        self.plan = plan
        self.groups = {group["name"]: group for group in (plan or {}).get("threadGroups", [])}
        self.reset()

    def handles(self, raw: dict) -> bool:
        return bool(self.groups) and not raw.get("stepId") and self._group_of(str(raw.get("threadName", ""))) is not None

    def _group_of(self, thread_name: str) -> dict | None:
        match = THREAD_NAME.match(thread_name)
        return self.groups.get(match.group("group")) if match else None

    def sample(self, raw: dict) -> list[dict]:
        thread = str(raw["threadName"])
        group = self._group_of(thread)
        steps = group["steps"]
        state = self.threads.setdefault(thread, {"iteration": 0, "position": -1, "visits": 0, "estimate": None})
        label = str(raw.get("label", ""))
        index = self._match(steps, state["position"], label)
        if index is None:
            state["iteration"] += 1
            index = self._match(steps, -1, label)
        events: list[dict] = []
        estimate = state["estimate"]
        correlation = f"{thread}#{state['iteration'] + 1}"
        if index is None:
            # The label is not in the registered plan: keep it visible as a raw sample.
            if estimate:
                events.append(self._cancel(estimate, raw.get("timestamp")))
                state["estimate"] = None
            return events + [{**raw, "eventType": "sample", "journeyId": group["id"], "unmatched": True}]
        if estimate and (estimate["stepId"] != steps[index]["id"] or estimate["correlationId"] != correlation):
            events.append(self._cancel(estimate, raw.get("startTime") or raw.get("timestamp")))
            estimate = None
        visit_id = estimate["visitId"] if estimate else self._visit_id(state, correlation, steps[index])
        state["position"] = index
        state["estimate"] = None
        success = bool(raw.get("success"))
        end = int(raw.get("timestamp") or 0)
        start = int(raw.get("startTime") or end - int(raw.get("elapsed") or 0))
        events.append(self._event(group, steps[index], correlation, visit_id, thread, state, {
            "phase": "completed" if success else "aborted", "outcome": "success" if success else "failure",
            "success": success, "status": raw.get("responseCode", raw.get("status", "")),
            "startedAt": start, "timestamp": end, "completedAt": end,
            "durationMs": int(raw.get("elapsed") or max(0, end - start)), "estimated": False,
            "latency": raw.get("latency", 0), "connect": raw.get("connect", 0), "bytes": raw.get("bytes", 0),
            "failureMessage": raw.get("failureMessage", ""),
        }))
        policy = group.get("onSampleError", "continue")
        if not success and policy in STOPPING_POLICIES:
            events.append(self._event(group, steps[index], correlation, visit_id, thread, state, {
                "phase": "halted", "outcome": policy, "timestamp": end, "startedAt": end, "durationMs": 0,
            }))
            return events
        if not success and policy == "startnextloop":
            return events
        following = self._next(group, state, index)
        if following is not None:
            next_index, next_iteration = following
            next_correlation = f"{thread}#{next_iteration + 1}"
            next_step = steps[next_index]
            next_visit = self._visit_id(state, next_correlation, next_step)
            state["estimate"] = {"stepId": next_step["id"], "correlationId": next_correlation, "visitId": next_visit,
                                 "group": group, "step": next_step, "thread": thread}
            events.append(self._event(group, next_step, next_correlation, next_visit, thread, state, {
                "phase": "started", "outcome": "pending", "timestamp": end, "startedAt": end,
                "durationMs": 0, "estimated": True,
            }))
        return events

    def end_test(self, timestamp: int) -> list[dict]:
        events = [self._cancel(state["estimate"], timestamp) for state in self.threads.values() if state["estimate"]]
        self.reset()
        return events

    @staticmethod
    def _match(steps: list[dict], position: int, label: str) -> int | None:
        start = position if position >= 0 and steps[position]["repeat"] and steps[position]["label"] == label else position + 1
        for index in range(start, len(steps)):
            if steps[index]["label"] == label:
                return index
        return None

    @staticmethod
    def _next(group: dict, state: dict, index: int) -> tuple[int, int] | None:
        steps = group["steps"]
        if steps[index]["repeat"]:
            return index, state["iteration"]
        if index + 1 < len(steps):
            return index + 1, state["iteration"]
        loops = group.get("loops")
        if loops == -1 or (loops is not None and state["iteration"] + 1 < loops):
            return 0, state["iteration"] + 1
        return None

    @staticmethod
    def _visit_id(state: dict, correlation: str, step: dict) -> str:
        state["visits"] += 1
        return f"{correlation}|{step['id']}|{state['visits']}"

    def _cancel(self, estimate: dict, timestamp) -> dict:
        state = self.threads.get(estimate["thread"], {"iteration": 0})
        return self._event(estimate["group"], estimate["step"], estimate["correlationId"], estimate["visitId"],
                           estimate["thread"], state, {"phase": "cancelled", "outcome": "cancelled",
                                                       "timestamp": int(timestamp or 0), "durationMs": 0, "estimated": True})

    @staticmethod
    def _event(group: dict, step: dict, correlation: str, visit_id: str, thread: str, state: dict, fields: dict) -> dict:
        return {"eventType": "journey", "journeyId": group["id"], "journeyName": group["name"],
                "stepId": step["id"], "stepOrder": step["order"], "endpoint": step["label"],
                "correlationId": correlation, "requestId": visit_id, "jmeterThread": thread, **fields}
