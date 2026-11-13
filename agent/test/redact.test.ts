import { expect, it } from "vitest";
import { redactText, redactUrl } from "../src/redact";

it("redacts formatted and bare CPFs only when both check digits match", () => {
  const input = "CPF 529.982.247-25 / 52998224725; invalid 529.982.247-24 / 52998224715 / 11111111111 / 152998224725";
  const expected = "CPF [CPF] / [CPF]; invalid 529.982.247-24 / 52998224715 / 11111111111 / 152998224725";
  expect(redactText(input)).toBe(expected);
  expect(redactText(expected)).toBe(expected);
});

it("removes URL credentials, queries and fragments and redacts encoded identifiers in paths", () => {
  const input = "https://user:secret@example.test/api/529%2E982%2E247%2D25?token=secret#private";
  const expected = "https://example.test/api/%5BCPF%5D";
  expect(redactUrl(input)).toBe(expected);
  expect(redactUrl(expected)).toBe(expected);
  expect(redactText(`GET "${input}" and "/api/orders?name=secret" (person@example.test)`))
    .toBe(`GET "${expected}" and "/api/orders" ([EMAIL])`);
  expect(redactUrl("https://example.test/api/:id?q=1")).toBe("https://example.test/api/:id");
  const relative = redactText('GET "/api/529%2E982%2E247%2D25?token=secret"');
  expect(relative).toBe('GET "/api/%5BCPF%5D"');
  expect(redactText(relative)).toBe(relative);
});
