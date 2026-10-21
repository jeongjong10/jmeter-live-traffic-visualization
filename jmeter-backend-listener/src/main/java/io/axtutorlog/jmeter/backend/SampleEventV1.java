package io.axtutorlog.jmeter.backend;

/** The normalized payload shape agreed by event-contract-v1. */
public record SampleEventV1(
        long timestamp,
        String label,
        long elapsed,
        boolean success,
        String responseCode,
        long latency,
        long connect,
        long bytes,
        String flowId,
        String correlationId,
        String journeyId,
        String stepId,
        int stepOrder,
        String previousStepId,
        String phase,
        String outcome,
        long startTime,
        String threadName,
        String failureMessage) {
}
