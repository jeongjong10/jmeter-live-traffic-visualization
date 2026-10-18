package io.axtutorlog.jmeter.backend;

import java.util.List;

/** Minimal dependency-free serializer for the event-contract-v1 JSON array body. */
final class EventBatchJson {
    private EventBatchJson() {
    }

    static String serialize(List<SampleEventV1> events) {
        StringBuilder json = new StringBuilder("[");
        for (int index = 0; index < events.size(); index++) {
            if (index > 0) {
                json.append(',');
            }
            SampleEventV1 event = events.get(index);
            json.append("{\"timestamp\":").append(event.timestamp())
                    .append(",\"label\":\"").append(escape(event.label()))
                    .append("\",\"elapsed\":").append(event.elapsed())
                    .append(",\"success\":").append(event.success())
                    .append(",\"responseCode\":\"").append(escape(event.responseCode()))
                    .append("\",\"latency\":").append(event.latency())
                    .append(",\"connect\":").append(event.connect())
                    .append(",\"bytes\":").append(event.bytes())
                    .append(",\"flowId\":\"").append(escape(event.flowId())).append("\"")
                    .append(",\"correlationId\":\"").append(escape(event.correlationId())).append("\"")
                    .append(",\"journeyId\":\"").append(escape(event.journeyId())).append("\"")
                    .append(",\"stepId\":\"").append(escape(event.stepId())).append("\"")
                    .append(",\"stepOrder\":").append(event.stepOrder())
                    .append(",\"previousStepId\":\"").append(escape(event.previousStepId())).append("\"")
                    .append(",\"phase\":\"").append(escape(event.phase())).append("\"")
                    .append(",\"outcome\":\"").append(escape(event.outcome())).append("\"")
                    .append('}');
        }
        return json.append(']').toString();
    }

    private static String escape(String value) {
        if (value == null) {
            return "";
        }
        StringBuilder escaped = new StringBuilder(value.length());
        for (int index = 0; index < value.length(); index++) {
            char character = value.charAt(index);
            switch (character) {
                case '"' -> escaped.append("\\\"");
                case '\\' -> escaped.append("\\\\");
                case '\b' -> escaped.append("\\b");
                case '\f' -> escaped.append("\\f");
                case '\n' -> escaped.append("\\n");
                case '\r' -> escaped.append("\\r");
                case '\t' -> escaped.append("\\t");
                default -> {
                    if (character < 0x20) {
                        escaped.append(String.format("\\u%04x", (int) character));
                    } else {
                        escaped.append(character);
                    }
                }
            }
        }
        return escaped.toString();
    }
}
