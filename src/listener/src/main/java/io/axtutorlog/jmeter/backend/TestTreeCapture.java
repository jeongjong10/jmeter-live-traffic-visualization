package io.axtutorlog.jmeter.backend;

import java.lang.reflect.Field;
import java.util.Collection;
import org.apache.jmeter.engine.StandardJMeterEngine;
import org.apache.jmeter.testelement.TestElement;
import org.apache.jmeter.testelement.property.JMeterProperty;
import org.apache.jorphan.collections.HashTree;

/**
 * Serializes the test tree JMeter is actually running, so unsaved GUI edits
 * (disabled samplers, changed thread counts) reach the collector without a
 * manual .jmx re-registration.
 *
 * <p>Properties are kept shallow and name-based; response data never appears.</p>
 */
final class TestTreeCapture {
    /** Plan size cap: a runaway tree must not exhaust the collector request. */
    private static final int MAX_JSON_LENGTH = 2_000_000;
    private static final int MAX_DEPTH = 25;

    private TestTreeCapture() {
    }

    /** Returns the running test tree as collector JSON, or null when unavailable. */
    static String capture() {
        try {
            HashTree tree = runningTestTree();
            if (tree == null) {
                return null;
            }
            StringBuilder json = new StringBuilder();
            writeTree(json, tree, 0);
            return json.length() > MAX_JSON_LENGTH ? null : json.toString();
        } catch (Exception exception) {
            return null;
        }
    }

    /** The engine keeps its single instance and the running plan in private fields. */
    private static HashTree runningTestTree() throws Exception {
        Field engineField = StandardJMeterEngine.class.getDeclaredField("engine");
        engineField.setAccessible(true);
        Object engine = engineField.get(null);
        if (engine == null) {
            return null;
        }
        Field testField = StandardJMeterEngine.class.getDeclaredField("test");
        testField.setAccessible(true);
        return (HashTree) testField.get(engine);
    }

    /** Element nodes followed by their child list, mirroring the .jmx hashTree layout. */
    static void writeTree(StringBuilder json, HashTree tree, int depth) {
        json.append('[');
        boolean first = true;
        for (Object node : (Collection<Object>) tree.list()) {
            if (!(node instanceof TestElement element)) {
                continue;
            }
            if (!first) {
                json.append(',');
            }
            first = false;
            writeElement(json, element, depth);
            HashTree children = tree.get(node);
            json.append(',');
            if (children == null || children.size() == 0 || depth >= MAX_DEPTH) {
                json.append("[]");
            } else {
                writeTree(json, children, depth + 1);
            }
        }
        json.append(']');
    }

    private static void writeElement(StringBuilder json, TestElement element, int depth) {
        json.append("{\"tag\":\"").append(EventBatchJson.escape(simpleName(element)))
                .append("\",\"name\":\"").append(EventBatchJson.escape(element.getName()))
                .append("\",\"enabled\":").append(element.isEnabled())
                .append(",\"props\":{");
        boolean first = true;
        java.util.Iterator<JMeterProperty> properties = element.propertyIterator();
        while (properties.hasNext()) {
            JMeterProperty property = properties.next();
            String value = valueOf(property, depth);
            if (value == null) {
                continue;
            }
            if (!first) {
                json.append(',');
            }
            first = false;
            json.append('"').append(EventBatchJson.escape(property.getName()))
                    .append("\":\"").append(EventBatchJson.escape(value)).append('"');
        }
        json.append("}}");
    }

    /** Nested config elements (Arguments, controllers) serialize as their property map. */
    private static String valueOf(JMeterProperty property, int depth) {
        Object value = property.getObjectValue();
        if (depth >= MAX_DEPTH || !(value instanceof TestElement nested)) {
            return String.valueOf(property.getStringValue());
        }
        StringBuilder json = new StringBuilder();
        writeElement(json, nested, depth + 1);
        return json.toString();
    }

    /** e.g. "HTTPSamplerProxy" — the collector matches on the simple class name. */
    private static String simpleName(TestElement element) {
        String name = element.getClass().getSimpleName();
        return name.isEmpty() ? element.getClass().getSuperclass().getSimpleName() : name;
    }
}
