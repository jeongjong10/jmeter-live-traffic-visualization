package io.axtutorlog.jmeter.backend;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
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

        SampleEventV1 event = SampleEventNormalizer.normalize(result);

        assertEquals(1_250L, event.timestamp());
        assertEquals("GET /health", event.label());
        assertEquals(250L, event.elapsed());
        assertFalse(event.success());
        assertEquals("503", event.responseCode());
        assertEquals(220L, event.latency());
        assertEquals(30L, event.connect());
        assertEquals(result.getBytesAsLong(), event.bytes());
        assertEquals("checkout-test-001", event.flowId());
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
}
