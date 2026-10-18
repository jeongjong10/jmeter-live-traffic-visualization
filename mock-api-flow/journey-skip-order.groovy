import groovy.json.JsonOutput
import java.net.HttpURLConnection
import java.net.URL

def label = sampler.getName()
def match = (label =~ /STEP:([a-z-]+)\|ORDER:(\d+)/)
if (!match.find()) throw new IllegalStateException("Journey label is invalid: " + label)
def failedOrder = Integer.parseInt(match[0][2])
vars.put("step${failedOrder}Ok", prev.isSuccessful() ? "true" : "false")
if (prev.isSuccessful()) return
def steps = ["auth", "session", "search", "product-detail", "cart", "payment", "order-confirmation"]
def timestamp = System.currentTimeMillis()
for (int index = failedOrder; index < steps.size(); index++) {
    def event = [eventType: "journey", timestamp: timestamp, completedAt: timestamp,
        correlationId: vars.get("correlationId"), journeyId: "checkout", stepId: steps[index],
        stepOrder: index + 1, previousStepId: steps[index - 1], phase: "skipped", outcome: "skipped",
        status: "SKIPPED", durationMs: 0, scenario: vars.get("scenario"), jmeterThread: ctx.getThreadNum() + 1]
    def connection = (HttpURLConnection) new URL(props.get("journeyCollectorUrl", "http://127.0.0.1:8765/events")).openConnection()
    connection.setRequestMethod("POST"); connection.setConnectTimeout(1000); connection.setReadTimeout(2000); connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/json")
    connection.outputStream.withCloseable { it.write(JsonOutput.toJson(event).getBytes("UTF-8")) }
    if (connection.responseCode < 200 || connection.responseCode >= 300) throw new IllegalStateException("Journey skip rejected")
}
