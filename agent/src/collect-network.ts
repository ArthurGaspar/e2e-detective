import type { BrowserContext, Request } from "@playwright/test";
import type { NetworkCall } from "./evidence";
import { redactText, redactUrl } from "./redact";

export function collectNetwork(context: BrowserContext) {
  const requests = new Map<Request, NetworkCall>();
  const consoleErrors: string[] = [];
  context.on("request", (request) => {
    const url = redactUrl(request.url());
    if (url) requests.set(request, { url, status: 0, ms: 0 });
  });
  context.on("response", (response) => {
    const call = requests.get(response.request());
    if (call) call.status = response.status();
  });
  context.on("requestfinished", (request) => {
    const call = requests.get(request);
    if (call) call.ms = Math.max(0, request.timing().responseEnd);
  });
  context.on("requestfailed", (request) => {
    const call = requests.get(request);
    if (call) call.failure = redactText(request.failure()?.errorText ?? "Request failed");
  });
  context.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(redactText(message.text()).slice(0, 300));
  });
  return { network: () => [...requests.values()], consoleErrors };
}
