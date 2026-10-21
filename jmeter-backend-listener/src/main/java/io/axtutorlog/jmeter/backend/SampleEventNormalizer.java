package io.axtutorlog.jmeter.backend;

import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.apache.jmeter.assertions.AssertionResult;
import org.apache.jmeter.samplers.SampleResult;

/** Converts JMeter's mutable result type to the transport-neutral v1 event. */
final class SampleEventNormalizer {
    private static final Pattern JOURNEY_LABEL = Pattern.compile(
            "JOURNEY:([^|]+)\\|CORRELATION:([^|]+)\\|STEP:([^|]+)\\|ORDER:(\\d+)\\|PREVIOUS:([^|]*)");
    private static final Pattern LEGACY_JOURNEY_LABEL = Pattern.compile(
            "STEP:(\\d+)-(auth|catalog|order) \\| SCENARIO:(success|slow|failure)");
    /** Failure reasons are capped: assertion scripts may quote response content. */
    static final int FAILURE_MESSAGE_LIMIT = 200;

    private SampleEventNormalizer() {
    }

    static SampleEventV1 normalize(SampleResult result) {
        JourneyMetadata journey = journey(result);
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
                "",
                journey.correlationId(),
                journey.journeyId(),
                journey.stepId(),
                journey.stepOrder(),
                journey.previousStepId(),
                result.isSuccessful() ? "completed" : "aborted",
                outcome,
                result.getStartTime(),
                result.getThreadName(),
                failureMessage(result));
    }

    /** Failed assertions (or the response message when none failed); empty for successful samples. */
    static String failureMessage(SampleResult result) {
        if (result.isSuccessful()) {
            return "";
        }
        StringBuilder message = new StringBuilder();
        for (AssertionResult assertion : result.getAssertionResults()) {
            if (assertion.isFailure() || assertion.isError()) {
                if (message.length() > 0) {
                    message.append("; ");
                }
                message.append(assertion.getName()).append(": ").append(assertion.getFailureMessage());
            }
        }
        String text = message.length() > 0 ? message.toString()
                : result.getResponseMessage() == null ? "" : result.getResponseMessage();
        return text.length() > FAILURE_MESSAGE_LIMIT ? text.substring(0, FAILURE_MESSAGE_LIMIT) + "…" : text;
    }

    /**
     * The JMeter listener receives a sample only after it finishes.  The label
     * carries immutable journey identity while started/skipped lifecycle events
     * are emitted by the JMX pre/post processors directly to the collector.
     */
    private static JourneyMetadata journey(SampleResult result) {
        String label = result.getSampleLabel() == null ? "" : result.getSampleLabel();
        Matcher match = JOURNEY_LABEL.matcher(label);
        if (match.find()) return new JourneyMetadata(match.group(2), match.group(1), match.group(3),
                Integer.parseInt(match.group(4)), match.group(5));
        Matcher legacy = LEGACY_JOURNEY_LABEL.matcher(label);
        if (!legacy.find()) return JourneyMetadata.EMPTY;
        int order = Integer.parseInt(legacy.group(1));
        return new JourneyMetadata("", "checkout", legacy.group(2), order,
                order == 1 ? "" : order == 2 ? "auth" : "catalog");
    }

    private record JourneyMetadata(String correlationId, String journeyId, String stepId,
                                   int stepOrder, String previousStepId) {
        static final JourneyMetadata EMPTY = new JourneyMetadata("", "", "", 0, "");
    }
}
