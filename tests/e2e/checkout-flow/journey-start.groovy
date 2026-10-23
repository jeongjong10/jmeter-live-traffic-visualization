import groovy.json.JsonOutput
import java.net.HttpURLConnection
import java.net.URL

def label = sampler.getName()
def match = (label =~ /STEP:([a-z-]+)\|ORDER:(\d+)/)
if (!match.find()) throw new IllegalStateException("Journey label is invalid: " + label)
def step = match[0][1]
def order = Integer.parseInt(match[0][2])
def steps = ["auth", "session", "search", "product-detail", "cart", "payment", "order-confirmation"]
if (!steps.contains(step) || order != steps.indexOf(step) + 1) throw new IllegalStateException("Unknown journey step: " + label)

if (order == 1) {
    def thread = ctx.getThreadNum() + 1
    def round = vars.getIteration()
    // Keep the visible round IDs one-based while retaining four failures in
    // this 12 VU × 2 deterministic fixture.
    def mix = thread + round + 1
    vars.put("correlationId", "checkout-t${thread}-r${round}")
    vars.put("scenario", mix % 7 == 0 ? "failure" : (mix % 3 == 0 ? "slow" : "success"))
}
def scenario = vars.get("scenario")
def delayMs = (scenario == "slow" && step == "search") ? "1200" : (scenario == "slow" && step == "payment" ? "450" : "0")
vars.put("delayMs", delayMs)
def previous = order == 1 ? "" : steps[order - 2]
sampler.setName("JOURNEY:checkout|CORRELATION:${vars.get('correlationId')}|STEP:${step}|ORDER:${order}|PREVIOUS:${previous}")
def routes = [auth:"/auth/login", session:"/profile/session", search:"/catalog/search",
              "product-detail":"/catalog/products/sku-espresso", cart:"/cart/items",
              payment:"/payments/authorize", "order-confirmation":"/orders/confirm"]
sampler.setPath(routes[step] + "?flowId=${vars.get('correlationId')}&scenario=${scenario}&delayMs=${delayMs}")

def timestamp = System.currentTimeMillis()
def event = [eventType: "journey", timestamp: timestamp, startedAt: timestamp,
    correlationId: vars.get("correlationId"), journeyId: "checkout", stepId: step,
    stepOrder: order, previousStepId: previous, phase: "started", outcome: "pending",
    status: "ACTIVE", durationMs: 0, scenario: scenario, jmeterThread: ctx.getThreadNum() + 1]
def connection = (HttpURLConnection) new URL(props.get("journeyCollectorUrl", "http://127.0.0.1:8765/events")).openConnection()
connection.setRequestMethod("POST"); connection.setConnectTimeout(1000); connection.setReadTimeout(2000); connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/json")
connection.outputStream.withCloseable { it.write(JsonOutput.toJson(event).getBytes("UTF-8")) }
if (connection.responseCode < 200 || connection.responseCode >= 300) throw new IllegalStateException("Journey start rejected: HTTP " + connection.responseCode)
