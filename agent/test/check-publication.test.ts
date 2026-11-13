import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { checkPublication } from "../src/check-publication";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "detective-publication-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

it("checks nested JSON values, numbers, keys and encoded identifiers", () => {
  mkdirSync(join(root, "cases"));
  const fixtures = {
    "snapshot.json": '{"snapshot":"CPF 529\\u002e982.247-25"}',
    "numeric.json": '{"attempts":[{"console":[52998224725]}]}',
    "key.json": '{"person@example.test":true}',
    "network.json": '{"url":"https://example.test/api/person%40example.test"}',
    "query.json": '{"url":"/api?%6eome=example"}',
    "fields.json": '{"nomeCompleto":"Example Person"}',
  };
  for (const [file, data] of Object.entries(fixtures)) writeFileSync(join(root, "cases", file), data);
  const findings = checkPublication(root);
  expect(findings).toHaveLength(Object.keys(fixtures).length);
  for (const file of Object.keys(fixtures)) expect(findings.some((finding) => finding.includes(file))).toBe(true);
  expect(findings.join("\n")).not.toMatch(/529|example\.test|Example Person/);
});

it("accepts redacted evidence and rejects sensitive filenames without printing them", () => {
  writeFileSync(join(root, "index.json"), '{"cpf":"[CPF]","email":"[EMAIL]","telefone":"***","url":"/api?op=ack","invalid":"529.982.247-24"}');
  expect(checkPublication(root)).toEqual([]);
  writeFileSync(join(root, "52998224725.txt"), "");
  expect(checkPublication(root)).toEqual(["Nome de arquivo ou diretório com dado pessoal ou caractere de controle"]);
});

it("checks screenshot text and blocks unsupported or unreadable artifacts", () => {
  writeFileSync(join(root, "capture.jpg"), "");
  writeFileSync(join(root, "payload.zip"), "");
  writeFileSync(join(root, "broken.json"), "{");
  const findings = checkPublication(root, () => "CPF 529.982.247-25");
  expect(findings).toEqual([
    "broken.json — falha ao ler, interpretar ou executar OCR no artefato",
    "capture.jpg — possível dado pessoal sem redação",
    "payload.zip — formato de artefato não verificado",
  ]);
  expect(checkPublication(root, () => { throw new Error("OCR failed"); }))
    .toContain("capture.jpg — falha ao ler, interpretar ou executar OCR no artefato");
});
