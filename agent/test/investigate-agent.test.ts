import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { investigateAgent } from "../src/investigate-agent";
import type { AssistantTurn, ToolMessage } from "../src/llm";
import type { CaseDoc } from "../src/store";

const evidence = JSON.parse(readFileSync(new URL(
  "../../dashboard/public/sample/cases/20261026T201612Z-2vhi9r-2.json", import.meta.url,
), "utf8")) as CaseDoc;

it("returns tool results to the model, reruns only a recorded locator once, and keeps the draft", async () => {
  const c = structuredClone(evidence);
  c.attempts[0].api = [
    { url: "https://example.test/api/cases?token=secret", status: 503, ms: 42 },
    { url: "https://example.test/api/ack", status: 200, ms: 9 },
  ];
  const locator = c.healLeads[0].locator;
  const rerun = vi.fn(async () => ({ outcome: "expected", error: undefined }));
  const chatWithTools = vi.fn<(messages: ToolMessage[]) => Promise<AssistantTurn>>()
    .mockResolvedValueOnce({
      role: "assistant", content: "", tool_calls: [
        { function: { name: "list_network", arguments: { status: 503 } } },
        { function: { name: "find_similar_locators", arguments: {} } },
        { function: { name: "rerun_test", arguments: { locator: "unrecorded" } } },
        { function: { name: "rerun_test", arguments: { locator } } },
        { function: { name: "rerun_test", arguments: { locator } } },
        { function: { name: "draft_issue", arguments: { title: "Case state", body: "Review the recorded state." } } },
      ],
    })
    .mockImplementationOnce(async (messages) => {
      const results = messages.filter((m) => m.role === "tool").map((m) => JSON.parse(m.content));
      expect(results[0]).toEqual({ total: 1, calls: [{ retry: 0, path: "/api/cases", status: 503, ms: 42 }] });
      expect(results[1][0].locator).toBe(locator);
      expect(results[2].error).toMatch(/Choose a locator/);
      expect(results[3].outcome).toBe("expected");
      expect(results[4].error).toMatch(/already been used/);
      expect(results[5].drafted).toBe(true);
      return { role: "assistant", content: JSON.stringify({ verdict: "real_bug", confidence: 0.9 }) };
    });

  const report = await investigateAgent({ model: "test", chatWithTools }, c, rerun);
  expect(rerun).toHaveBeenCalledExactlyOnceWith(c, c.healLeads[0]);
  expect(report.issueDraft).toEqual({ title: "Case state", body: "Review the recorded state." });
});
