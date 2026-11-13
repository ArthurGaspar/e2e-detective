import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { hasPersonalIdentifier } from "./redact";

const textFormats = new Set([".css", ".html", ".js", ".json", ".md", ".svg", ".txt"]);
const imageFormats = new Set([".jpeg", ".jpg", ".png"]);
const sensitiveQuery = /[?&](?:cpf|e-?mail|phone|telefone|password|senha|token|name|nome|address|endereco)=[^&#\s"'<>]+/i;
const personalField = /^(?:e-?mail|phone|telefone|celular|full[_-]?name|nome[_-]?completo|street[_-]?address|endere[cç]o)$/i;
const urlCredentials = /https?:\/\/[^\s/"'<>]+:[^\s/"'<>]+@[^\s/"'<>]+/i;
const urlInText = /https?:\/\/[^\s"'<>]+|(?:^|[\s"'(<])\/[^\s"'<>]+/gi;
const brazilianPhone = /(?<!\d)(?:\+55[ \t-]*)?\(\d{2}\)[ \t]*\d{4,5}-\d{4}(?!\d)/;

function decodeAsciiEscapes(value: string): string {
  return value.replace(/%[0-7][0-9a-f]/gi, (escape) => String.fromCharCode(Number.parseInt(escape.slice(1), 16)));
}

function hasPersonalData(value: string): boolean {
  const decoded = decodeAsciiEscapes(value);
  return hasPersonalIdentifier(decoded) || brazilianPhone.test(decoded) || urlCredentials.test(value)
    || [...value.matchAll(urlInText)].some(([url]) =>
      sensitiveQuery.test(decodeAsciiEscapes(url.replace(/&amp;|&#38;|&#x26;/gi, "&"))),
    );
}

function hasUnmaskedValue(value: unknown): boolean {
  if (typeof value === "number") return true;
  return typeof value === "string" && !/^\s*(?:\[(?:REDACTED|EMAIL|PHONE|NAME|ADDRESS)\]|\*+)?\s*$/i.test(value);
}

function hasPersonalDataInJson(value: unknown): boolean {
  if (typeof value === "string") return hasPersonalData(value);
  if (typeof value === "number") return Number.isInteger(value) && hasPersonalData(String(value));
  if (Array.isArray(value)) return value.some(hasPersonalDataInJson);
  return value !== null && typeof value === "object"
    && Object.entries(value).some(([key, item]) =>
      hasPersonalData(key) || (personalField.test(key) && hasUnmaskedValue(item)) || hasPersonalDataInJson(item),
    );
}

function readImageText(file: string): string {
  const result = spawnSync(process.env.TESSERACT ?? "tesseract", [file, "stdout", "--psm", "11"], {
    encoding: "utf8", timeout: 30_000, windowsHide: true,
  });
  if (result.status !== 0) throw new Error("OCR indisponível ou imagem ilegível");
  return result.stdout;
}

export function checkPublication(root: string, ocr = readImageText): string[] {
  const findings: string[] = [];
  function visit(relative: string) {
    const file = join(root, relative);
    const label = relative || ".";
    if (hasPersonalData(relative) || /[\x00-\x1f\x7f]/.test(relative)) {
      findings.push("Nome de arquivo ou diretório com dado pessoal ou caractere de controle");
      return;
    }

    try {
      const stat = lstatSync(file);
      if (stat.isDirectory()) {
        for (const name of readdirSync(file).sort()) {
          if (!relative && name === ".git") continue;
          visit(join(relative, name));
        }
        return;
      }

      const ext = extname(file).toLowerCase();
      if (!stat.isFile() || (!textFormats.has(ext) && !imageFormats.has(ext))) {
        findings.push(`${label} — formato de artefato não verificado`);
        return;
      }

      const data = readFileSync(file, "utf8");
      const found = ext === ".json" ? hasPersonalDataInJson(JSON.parse(data))
        : imageFormats.has(ext) ? hasPersonalData(data) || hasPersonalData(ocr(file))
        : hasPersonalData(data);
      if (found) findings.push(`${label} — possível dado pessoal sem redação`);
    } catch {
      findings.push(`${label} — falha ao ler, interpretar ou executar OCR no artefato`);
    }
  }

  visit("");
  return findings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.argv[2];
  if (!root) {
    console.error("Uso: npm run check:publication -- <diretório>");
    process.exitCode = 1;
  } else {
    const findings = checkPublication(root);
    if (findings.length) {
      for (const finding of findings) console.error(finding);
      process.exitCode = 1;
    } else {
      console.log("Verificação dos artefatos concluída.");
    }
  }
}
