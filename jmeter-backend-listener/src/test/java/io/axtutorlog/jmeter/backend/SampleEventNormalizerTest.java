package io.axtutorlog.jmeter.backend;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import org.apache.jmeter.assertions.AssertionResult;
import org.apache.jmeter.samplers.SampleResult;
import org.junit.jupiter.api.Test;

class SampleEventNormalizerTest {
    @Test
    void mapsTheV1ContractFieldsFromTheCompletedSample() {
        SampleResult result = new SampleResult();
        result.setSampleLabel("GET /health");
        result.setStampAndTime(1_250L, 250L);
        result.setSuccessful(false);
        result.setResponseCode("503");
        result.setLatency(220L);
        result.setConnectTime(30L);
        result.setResponseData("{\"flowId\":\"checkout-test-001\"}");
        result.setBytes(4_096L);
        result.setThreadName("btco KCAT 비즈니스 프로세스 TG 1-1");

        SampleEventV1 event = SampleEventNormalizer.normalize(result);

        assertEquals(1_250L, event.timestamp());
        assertEquals("GET /health", event.label());
        assertEquals(250L, event.elapsed());
        assertFalse(event.success());
        assertEquals("503", event.responseCode());
        assertEquals(220L, event.latency());
        assertEquals(30L, event.connect());
        assertEquals(result.getBytesAsLong(), event.bytes());
        // Response bodies are never read, even when they carry a flowId.
        assertEquals("", event.flowId());
        assertEquals(1_000L, event.startTime());
        assertEquals("btco KCAT 비즈니스 프로세스 TG 1-1", event.threadName());
    }

    @Test
    void derivesJourneyV2CompletionFieldsFromTheSamplerLabel() {
        SampleResult result = new SampleResult();
        result.setSampleLabel("JOURNEY:checkout|CORRELATION:checkout-slow-001|STEP:catalog|ORDER:2|PREVIOUS:auth");
        result.setStampAndTime(1_250L, 900L);
        result.setSuccessful(true);

        SampleEventV1 event = SampleEventNormalizer.normalize(result);

        assertEquals("checkout-slow-001", event.correlationId());
        assertEquals("checkout", event.journeyId());
        assertEquals("catalog", event.stepId());
        assertEquals(2, event.stepOrder());
        assertEquals("auth", event.previousStepId());
        assertEquals("completed", event.phase());
        assertEquals("success", event.outcome());
    }

    @Test
    void reportsFailedAssertionsCappedAndNothingForSuccess() {
        SampleResult failed = new SampleResult();
        failed.setSuccessful(false);
        failed.setResponseMessage("OK");
        AssertionResult assertion = new AssertionResult("DTO:Response JSR223 Assertion");
        assertion.setFailure(true);
        assertion.setFailureMessage("x".repeat(300));
        failed.addAssertionResult(assertion);

        String message = SampleEventNormalizer.failureMessage(failed);

        assertEquals(SampleEventNormalizer.FAILURE_MESSAGE_LIMIT + 1, message.length());
        assertEquals("DTO:Response JSR223 Assertion: xxx", message.substring(0, 34));

        SampleResult httpError = new SampleResult();
        httpError.setSuccessful(false);
        httpError.setResponseMessage("Internal Server Error");
        assertEquals("Internal Server Error", SampleEventNormalizer.failureMessage(httpError));

        SampleResult ok = new SampleResult();
        ok.setSuccessful(true);
        ok.addAssertionResult(assertion);
        assertEquals("", SampleEventNormalizer.failureMessage(ok));
    }

    @Test
    void toleratesSamplesWithoutLabelOrResponseData() {
        SampleResult result = new SampleResult();
        result.setSampleLabel(null);
        result.setSuccessful(true);

        SampleEventV1 event = SampleEventNormalizer.normalize(result);

        assertEquals("", event.stepId());
        assertEquals("completed", event.phase());
    }
}
