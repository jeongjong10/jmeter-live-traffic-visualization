package io.axtutorlog.jmeter.backend;

import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.apache.jmeter.samplers.SampleResult;

/** Converts JMeter's mutable result type to the transport-neutral v1 event. */
final class SampleEventNormalizer {
    private static final Pattern FLOW_ID = Pattern.compile("\\\"flowId\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"");
    private static final Pattern JOURNEY_LABEL = Pattern.compile(
            "JOURNEY:([^|]+)\\|CORRELATION:([^|]+)\\|STEP:([^|]+)\\|ORDER:(\\d+)\\|PREVIOUS:([^|]*)");
    private static final Pattern LEGACY_JOURNEY_LABEL = Pattern.compile(
            "STEP:(\\d+)-(auth|catalog|order) \\| SCENARIO:(success|slow|failure)");
    private SampleEventNormalizer() {
    }

    static SampleEventV1 normalize(SampleResult result) {
        JourneyMetadata journey = journey(result, flowId(result));
        String outcome = result.isSuccessful() ? "success" : "failure";
        return new SampleEventV1(
                result.getEndTime(),
                result.getSampleLabel(),
                result.getTime(),
                result.isSuccessful(),
                result.getResponseCode(),
                result.getLatency(),
                result.getConnectTime(),
                result.getBytesAsLong(),
                flowId(result),
                journey.correlationId(),
                journey.journeyId(),
                journey.stepId(),
                journey.stepOrder(),
                journey.previousStepId(),
                result.isSuccessful() ? "completed" : "aborted",
                outcome);
    }

    /** Carries a mock/API correlation id so UI can join the three business steps. */
    private static String flowId(SampleResult result) {
        Matcher match = FLOW_ID.matcher(result.getResponseDataAsString());
        return match.find() ? match.group(1) : "";
    }

    /**
     * The JMeter listener receives a sample only after it finishes.  The label
     * carries immutable journey identity while started/skipped lifecycle events
     * are emitted by the JMX pre/post processors directly to the collector.
     */
    private static JourneyMetadata journey(SampleResult result, String flowId) {
        Matcher match = JOURNEY_LABEL.matcher(result.getSampleLabel());
        if (match.find()) return new JourneyMetadata(match.group(2), match.group(1), match.group(3),
                Integer.parseInt(match.group(4)), match.group(5));
        Matcher legacy = LEGACY_JOURNEY_LABEL.matcher(result.getSampleLabel());
        if (!legacy.find()) return JourneyMetadata.EMPTY;
        int order = Integer.parseInt(legacy.group(1));
        return new JourneyMetadata(flowId, "checkout", legacy.group(2), order,
                order == 1 ? "" : order == 2 ? "auth" : "catalog");
    }

    private record JourneyMetadata(String correlationId, String journeyId, String stepId,
                                   int stepOrder, String previousStepId) {
        static final JourneyMetadata EMPTY = new JourneyMetadata("", "", "", 0, "");
    }
}
