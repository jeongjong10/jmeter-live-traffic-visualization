"""Reads a JMeter .jmx into the step plan the flow visualizer draws.

Only enabled elements are kept. Each sampler becomes one step in tree order, so
two samplers with the same label stay two distinct steps. Samplers inside a
loop are marked ``repeat``. Elements outside the supported set are reported as
warnings instead of being guessed at.
"""
from __future__ import annotations

import json
import xml.etree.ElementTree as ET

THREAD_GROUPS = {"ThreadGroup", "SetupThreadGroup", "PostThreadGroup"}
LOOP_CONTROLLERS = {"LoopController", "WhileController", "ForeachController"}
# Controllers whose children run in order exactly once per pass.
TRANSPARENT_CONTROLLERS = {"GenericController", "IfController"}
# Elements that never produce a sample and do not change the step order.
NON_SAMPLE_TAGS = {
    "TestAction", "HeaderManager", "CookieManager", "CacheManager", "AuthManager", "DNSCacheManager",
    "Arguments", "ConfigTestElement", "CSVDataSet", "ResultCollector", "BackendListener",
    "JSONPostProcessor", "RegexExtractor", "BoundaryExtractor", "XPath2Extractor", "HtmlExtractor",
    "DebugPostProcessor", "JSR223PreProcessor", "JSR223PostProcessor", "BeanShellPreProcessor",
    "BeanShellPostProcessor", "UserParameters", "JSONPathAssertion", "JSR223Assertion",
    "ResponseAssertion", "DurationAssertion", "SizeAssertion", "ConstantTimer", "UniformRandomTimer",
    "GaussianRandomTimer", "ConstantThroughputTimer", "PreciseThroughputTimer", "SyncTimer",
    "CounterConfig", "RandomVariableConfig", "Summariser", "kg.apc.jmeter.timers.VariableThroughputTimer",
}


def _props(element: ET.Element) -> dict[str, str]:
    """Direct child properties of any type (stringProp, intProp, longProp, boolProp)."""
    return {child.get("name", ""): (child.text or "").strip() for child in element if child.get("name")}


def _number(value: str | None) -> int | None:
    try:
        return int(float(value)) if value not in (None, "") else None
    except ValueError:
        return None  # e.g. "${__P(threads,10)}": resolved only at run time


def _enabled(element: ET.Element) -> bool:
    return element.get("enabled", "true") != "false"


def _pairs(hash_tree: ET.Element):
    children = list(hash_tree)
    index = 0
    while index < len(children):
        element = children[index]
        subtree = children[index + 1] if index + 1 < len(children) and children[index + 1].tag == "hashTree" else None
        yield element, subtree
        index += 2 if subtree is not None else 1


def _thread_group(element: ET.Element) -> dict:
    props = _props(element)
    main = element.find("elementProp[@name='ThreadGroup.main_controller']")
    main_props = _props(main) if main is not None else {}
    loops = _number(main_props.get("LoopController.loops"))
    if main_props.get("LoopController.continue_forever") == "true" and loops is None:
        loops = -1
    scheduler = props.get("ThreadGroup.scheduler") == "true"
    return {
        "name": element.get("testname", ""),
        "threads": _number(props.get("ThreadGroup.num_threads")),
        "rampUpSeconds": _number(props.get("ThreadGroup.ramp_time")),
        "loops": loops,
        "durationSeconds": _number(props.get("ThreadGroup.duration")) if scheduler else None,
        "startDelaySeconds": _number(props.get("ThreadGroup.delay")) if scheduler else None,
        "scheduler": scheduler,
        # Absent properties take JMeter's defaults (same user: true, delayed start: false).
        "sameUserOnNextIteration": props.get("ThreadGroup.same_user_on_next_iteration", "true") == "true",
        "delayedStart": props.get("ThreadGroup.delayedStart") == "true",
        "onSampleError": props.get("ThreadGroup.on_sample_error") or "continue",
        "steps": [],
    }


def _sampler_step(element: ET.Element, repeat: bool) -> dict:
    props = _props(element)
    return {
        "label": element.get("testname", ""),
        "method": props.get("HTTPSampler.method", "") if element.tag == "HTTPSamplerProxy" else "",
        "path": props.get("HTTPSampler.path", "") if element.tag == "HTTPSamplerProxy" else "",
        "sampler": element.tag,
        "repeat": repeat,
    }


def _collect(hash_tree: ET.Element, group: dict, repeat: bool, warnings: list[str]) -> None:
    for element, subtree in _pairs(hash_tree):
        if not _enabled(element):
            continue
        tag = element.tag
        if tag.endswith("Sampler") or tag.endswith("SamplerProxy"):
            group["steps"].append(_sampler_step(element, repeat))
            if tag != "HTTPSamplerProxy":
                warnings.append(f"{group['name']}: HTTP가 아닌 Sampler '{element.get('testname')}'({tag})는 단계로만 표시합니다.")
            if "${" in element.get("testname", ""):
                warnings.append(f"{group['name']}: Sampler 이름에 변수가 있어 실행 결과와 짝지을 수 없습니다: '{element.get('testname')}'")
            continue
        if tag in LOOP_CONTROLLERS:
            loops = _number(_props(element).get("LoopController.loops"))
            nested_repeat = repeat or tag != "LoopController" or loops is None or loops != 1
            if subtree is not None:
                _collect(subtree, group, nested_repeat, warnings)
            continue
        if tag in TRANSPARENT_CONTROLLERS:
            if subtree is not None:
                _collect(subtree, group, repeat, warnings)
            continue
        if tag in NON_SAMPLE_TAGS:
            continue
        warnings.append(f"{group['name']}: 지원하지 않는 요소 '{element.get('testname')}'({tag})는 순서대로 펼쳐 표시합니다.")
        if subtree is not None:
            _collect(subtree, group, repeat, warnings)


def parse_jmx(data: bytes | str) -> dict:
    """Return {testPlan, threadGroups[], warnings[]} for the enabled thread groups."""
    root = ET.fromstring(data)
    top = root.find("hashTree")
    if top is None:
        raise ValueError("jmx 형식이 아닙니다: 최상위 hashTree가 없습니다.")
    warnings: list[str] = []
    groups: list[dict] = []
    test_plan = ""
    for plan, plan_tree in _pairs(top):
        if plan.tag != "TestPlan":
            continue
        test_plan = plan.get("testname", "")
        if plan_tree is None:
            continue
        for element, subtree in _pairs(plan_tree):
            if element.tag not in THREAD_GROUPS or not _enabled(element):
                continue
            group = _thread_group(element)
            if subtree is not None:
                _collect(subtree, group, False, warnings)
            if not group["steps"]:
                continue
            group["id"] = f"tg{len(groups) + 1}"
            for order, step in enumerate(group["steps"], start=1):
                step["id"] = f"{group['id']}-s{order}"
                step["order"] = order
            groups.append(group)
    if not groups:
        raise ValueError("활성화된 Thread Group에 Sampler가 없습니다.")
    return {"testPlan": test_plan, "threadGroups": groups, "warnings": warnings}


def _fill_element(element: ET.Element, node: dict) -> None:
    """Copy name/enabled and properties; a nested config element arrives as JSON text."""
    for name, value in node.get("props", {}).items():
        child = ET.SubElement(element, "stringProp", {"name": name})
        nested = None
        if isinstance(value, str) and value.startswith("{"):
            try:
                parsed = json.loads(value)
            except ValueError:
                parsed = None
            if isinstance(parsed, dict) and "tag" in parsed:
                nested = parsed
        if nested is None:
            child.text = str(value)
            continue
        # Keep the .jmx elementProp tag; the nested type rides along as an attribute.
        child.tag = "elementProp"
        child.set("name", name)
        child.set("elementType", nested.get("tag") or "")
        _fill_element(child, nested)


def _nodes_to_hash_tree(parent: ET.Element, nodes: list) -> None:
    # The listener serializes each element followed by its child list, as in a .jmx.
    for index in range(0, len(nodes) - 1, 2):
        node, children = nodes[index], nodes[index + 1]
        element = ET.SubElement(parent, node.get("tag", "Unknown"), {
            "testname": node.get("name", ""),
            "enabled": "true" if node.get("enabled", True) else "false",
        })
        _fill_element(element, node)
        subtree = ET.SubElement(parent, "hashTree")
        if isinstance(children, list):
            _nodes_to_hash_tree(subtree, children)


def parse_test_tree(data) -> dict:
    """Same plan as parse_jmx, from the live test tree the listener captures."""
    nodes = json.loads(data) if isinstance(data, (str, bytes)) else data
    if not isinstance(nodes, list):
        raise ValueError("test tree는 요소 배열이어야 합니다.")
    root = ET.Element("jmeterTestPlan")
    top = ET.SubElement(root, "hashTree")
    _nodes_to_hash_tree(top, nodes)
    return parse_jmx(ET.tostring(root, encoding="unicode"))
