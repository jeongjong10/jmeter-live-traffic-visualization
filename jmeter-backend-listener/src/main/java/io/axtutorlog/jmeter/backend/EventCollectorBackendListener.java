package io.axtutorlog.jmeter.backend;

import java.net.URI;
import java.net.URISyntaxException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import org.apache.jmeter.config.Arguments;
import org.apache.jmeter.samplers.SampleResult;
import org.apache.jmeter.visualizers.backend.BackendListenerClient;
import org.apache.jmeter.visualizers.backend.BackendListenerContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * JMeter 5.6.3 Backend Listener which prepares event-contract-v1 batches.
 *
 * <p>Delivery is intentionally at-most-once: a failed request is logged and its
 * batch is dropped. Retrying here would risk duplicate load-test samples until
 * the collector supports an idempotency key.</p>
 */
public final class EventCollectorBackendListener implements BackendListenerClient {
    private static final Logger LOG = LoggerFactory.getLogger(EventCollectorBackendListener.class);
    public static final String COLLECTOR_URL = "collectorUrl";
    public static final String BATCH_SIZE = "batchSize";
    public static final String FLUSH_INTERVAL_MILLIS = "flushIntervalMillis";
    public static final String CONNECT_TIMEOUT_MILLIS = "connectTimeoutMillis";
    public static final String REQUEST_TIMEOUT_MILLIS = "requestTimeoutMillis";

    private CollectorConfiguration configuration;
    private final List<SampleEventV1> pendingEvents = new ArrayList<>();
    private long nextFlushAtMillis;
    private long normalizedCount;
    private long successfulBatchCount;
    private long failedBatchCount;
    private long droppedEventCount;
    private HttpClient httpClient;

    @Override
    public Arguments getDefaultParameters() {
        Arguments arguments = new Arguments();
        arguments.addArgument(COLLECTOR_URL, "http://127.0.0.1:8765/events");
        arguments.addArgument(BATCH_SIZE, "100");
        arguments.addArgument(FLUSH_INTERVAL_MILLIS, "1000");
        arguments.addArgument(CONNECT_TIMEOUT_MILLIS, "1000");
        arguments.addArgument(REQUEST_TIMEOUT_MILLIS, "2000");
        return arguments;
    }

    @Override
    public synchronized void setupTest(BackendListenerContext context) {
        configuration = CollectorConfiguration.from(context);
        httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(configuration.connectTimeoutMillis()))
                .build();
        pendingEvents.clear();
        normalizedCount = 0;
        successfulBatchCount = 0;
        failedBatchCount = 0;
        droppedEventCount = 0;
        nextFlushAtMillis = System.currentTimeMillis() + configuration.flushIntervalMillis();
        LOG.info("event-collector listener initialized (collectorUrl={}, batchSize={}, flushIntervalMillis={})",
                configuration.collectorUrl(), configuration.batchSize(), configuration.flushIntervalMillis());
    }

    @Override
    public synchronized void handleSampleResults(
            List<SampleResult> sampleResults, BackendListenerContext context) {
        ensureConfigured();
        for (SampleResult result : sampleResults) {
            pendingEvents.add(SampleEventNormalizer.normalize(result));
            normalizedCount++;
            if (pendingEvents.size() >= configuration.batchSize()) {
                flush("batch-size");
            }
        }
        if (System.currentTimeMillis() >= nextFlushAtMillis) {
            flush("interval");
        }
    }

    @Override
    public synchronized void teardownTest(BackendListenerContext context) {
        if (configuration != null) {
            flush("teardown");
        }
    }

    /** Package-visible diagnostics for unit tests and future health reporting. */
    synchronized ListenerMetrics metrics() {
        return new ListenerMetrics(normalizedCount, successfulBatchCount, failedBatchCount,
                droppedEventCount, pendingEvents.size());
    }

    private void ensureConfigured() {
        if (configuration == null) {
            throw new IllegalStateException("setupTest must run before receiving samples");
        }
    }

    private void flush(String reason) {
        if (pendingEvents.isEmpty()) {
            nextFlushAtMillis = System.currentTimeMillis() + configuration.flushIntervalMillis();
            return;
        }
        List<SampleEventV1> batch = List.copyOf(pendingEvents);
        pendingEvents.clear();
        nextFlushAtMillis = System.currentTimeMillis() + configuration.flushIntervalMillis();
        String body = EventBatchJson.serialize(batch);
        HttpRequest request = HttpRequest.newBuilder(configuration.collectorUrl())
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .timeout(Duration.ofMillis(configuration.requestTimeoutMillis()))
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .build();
        try {
            HttpResponse<Void> response = httpClient.send(request, HttpResponse.BodyHandlers.discarding());
            if (response.statusCode() >= 200 && response.statusCode() < 300) {
                successfulBatchCount++;
                LOG.info("event-collector batch delivered (reason={}, events={}, status={}, deliveredBatches={})",
                        reason, batch.size(), response.statusCode(), successfulBatchCount);
            } else {
                recordFailedBatch(reason, batch.size(), "HTTP " + response.statusCode());
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            recordFailedBatch(reason, batch.size(), "request interrupted");
        } catch (Exception exception) {
            recordFailedBatch(reason, batch.size(), exception.getClass().getSimpleName() + ": " + exception.getMessage());
        }
    }

    private void recordFailedBatch(String reason, int eventCount, String detail) {
        failedBatchCount++;
        droppedEventCount += eventCount;
        LOG.warn("event-collector batch dropped (reason={}, events={}, failure={}, policy=at-most-once-no-retry)",
                reason, eventCount, detail);
    }

    record ListenerMetrics(long normalized, long successfulBatches, long failedBatches,
                           long droppedEvents, int pending) {
    }

    private record CollectorConfiguration(URI collectorUrl, int batchSize, long flushIntervalMillis,
                                          long connectTimeoutMillis, long requestTimeoutMillis) {
        static CollectorConfiguration from(BackendListenerContext context) {
            Objects.requireNonNull(context, "context");
            String urlValue = context.getParameter(COLLECTOR_URL, "http://127.0.0.1:8765/events");
            String batchValue = context.getParameter(BATCH_SIZE, "100");
            String intervalValue = context.getParameter(FLUSH_INTERVAL_MILLIS, "1000");
            String connectTimeout = context.getParameter(CONNECT_TIMEOUT_MILLIS, "1000");
            String requestTimeout = context.getParameter(REQUEST_TIMEOUT_MILLIS, "2000");
            return new CollectorConfiguration(parseHttpUrl(urlValue), positiveInt(BATCH_SIZE, batchValue),
                    positiveLong(FLUSH_INTERVAL_MILLIS, intervalValue),
                    positiveLong(CONNECT_TIMEOUT_MILLIS, connectTimeout),
                    positiveLong(REQUEST_TIMEOUT_MILLIS, requestTimeout));
        }

        private static URI parseHttpUrl(String value) {
            try {
                URI uri = new URI(value);
                if (( !"http".equalsIgnoreCase(uri.getScheme()) && !"https".equalsIgnoreCase(uri.getScheme()))
                        || uri.getHost() == null || !isLoopbackHost(uri.getHost())) {
                    throw new IllegalArgumentException(COLLECTOR_URL + " must be an absolute loopback HTTP(S) URL");
                }
                return uri;
            } catch (URISyntaxException exception) {
                throw new IllegalArgumentException(COLLECTOR_URL + " is not a valid URI", exception);
            }
        }

        private static boolean isLoopbackHost(String host) {
            return "localhost".equalsIgnoreCase(host) || "127.0.0.1".equals(host)
                    || "::1".equals(host) || "[::1]".equals(host);
        }

        private static int positiveInt(String name, String value) {
            try {
                int parsed = Integer.parseInt(value);
                if (parsed <= 0) throw new NumberFormatException("must be positive");
                return parsed;
            } catch (NumberFormatException exception) {
                throw new IllegalArgumentException(name + " must be a positive integer", exception);
            }
        }

        private static long positiveLong(String name, String value) {
            try {
                long parsed = Long.parseLong(value);
                if (parsed <= 0) throw new NumberFormatException("must be positive");
                return parsed;
            } catch (NumberFormatException exception) {
                throw new IllegalArgumentException(name + " must be a positive integer", exception);
            }
        }
    }
}
