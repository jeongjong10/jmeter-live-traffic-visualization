package io.axtutorlog.jmeter.backend;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import org.apache.jmeter.samplers.SampleResult;
import org.apache.jmeter.visualizers.backend.BackendListenerContext;
import org.junit.jupiter.api.Test;

class EventCollectorBackendListenerTest {
    @Test
    void postsTheV1BatchToALoopbackCollector() throws IOException {
        AtomicReference<String> method = new AtomicReference<>();
        AtomicReference<String> contentType = new AtomicReference<>();
        AtomicReference<String> body = new AtomicReference<>();
        List<String> bodies = new java.util.concurrent.CopyOnWriteArrayList<>();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/events", exchange -> {
            method.set(exchange.getRequestMethod());
            contentType.set(exchange.getRequestHeaders().getFirst("Content-Type"));
            String received = new String(exchange.getRequestBody().readAllBytes());
            bodies.add(received);
            if (received.contains("\"label\"")) body.set(received);
            exchange.sendResponseHeaders(202, -1);
            exchange.close();
        });
        server.start();
        try {
        EventCollectorBackendListener listener = new EventCollectorBackendListener();
        BackendListenerContext context = new BackendListenerContext(Map.of(
                EventCollectorBackendListener.COLLECTOR_URL,
                "http://127.0.0.1:" + server.getAddress().getPort() + "/events",
                EventCollectorBackendListener.BATCH_SIZE, "2",
                EventCollectorBackendListener.FLUSH_INTERVAL_MILLIS, "60000"));
        listener.setupTest(context);

        listener.handleSampleResults(List.of(sample("one"), sample("two")), context);
        listener.teardownTest(context);

        EventCollectorBackendListener.ListenerMetrics metrics = listener.metrics();
        assertEquals(2, metrics.normalized());
        assertEquals(1, metrics.successfulBatches());
        assertEquals(0, metrics.failedBatches());
        assertEquals(0, metrics.pending());
        assertEquals(3, bodies.size());
        assertTrue(bodies.get(0).startsWith("[{\"eventType\":\"test\",\"phase\":\"started\""));
        assertTrue(bodies.get(2).startsWith("[{\"eventType\":\"test\",\"phase\":\"ended\""));
        assertEquals("POST", method.get());
        assertTrue(contentType.get().startsWith("application/json"));
        assertEquals("[{\"timestamp\":1000,\"label\":\"one\",\"elapsed\":1,\"success\":false,\"responseCode\":\"\",\"latency\":0,\"connect\":0,\"bytes\":0,\"flowId\":\"\",\"correlationId\":\"\",\"journeyId\":\"\",\"stepId\":\"\",\"stepOrder\":0,\"previousStepId\":\"\",\"phase\":\"aborted\",\"outcome\":\"failure\",\"startTime\":999,\"threadName\":\"\",\"failureMessage\":\"\"},{\"timestamp\":1000,\"label\":\"two\",\"elapsed\":1,\"success\":false,\"responseCode\":\"\",\"latency\":0,\"connect\":0,\"bytes\":0,\"flowId\":\"\",\"correlationId\":\"\",\"journeyId\":\"\",\"stepId\":\"\",\"stepOrder\":0,\"previousStepId\":\"\",\"phase\":\"aborted\",\"outcome\":\"failure\",\"startTime\":999,\"threadName\":\"\",\"failureMessage\":\"\"}]", body.get());
        } finally {
            server.stop(0);
        }
    }

    @Test
    void dropsAFailedBatchWithoutRetryingIt() throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/events", exchange -> {
            exchange.sendResponseHeaders(503, -1);
            exchange.close();
        });
        server.start();
        try {
            EventCollectorBackendListener listener = new EventCollectorBackendListener();
            BackendListenerContext context = new BackendListenerContext(Map.of(
                    EventCollectorBackendListener.COLLECTOR_URL,
                    "http://127.0.0.1:" + server.getAddress().getPort() + "/events",
                    EventCollectorBackendListener.BATCH_SIZE, "1",
                    EventCollectorBackendListener.FLUSH_INTERVAL_MILLIS, "60000"));
            listener.setupTest(context);

            listener.handleSampleResults(List.of(sample("unavailable")), context);

            EventCollectorBackendListener.ListenerMetrics metrics = listener.metrics();
            assertEquals(0, metrics.successfulBatches());
            assertEquals(1, metrics.failedBatches());
            assertEquals(1, metrics.droppedEvents());
            assertEquals(0, metrics.pending());
        } finally {
            server.stop(0);
        }
    }

    private static SampleResult sample(String label) {
        SampleResult result = new SampleResult();
        result.setSampleLabel(label);
        result.setStampAndTime(1_000L, 1L);
        return result;
    }
}
