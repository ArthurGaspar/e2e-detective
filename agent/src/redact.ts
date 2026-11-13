const CPF = /(?<!\d)(?:\d{3}\.\d{3}\.\d{3}-\d{2}|\d{11})(?!\d)/g;
const EMAIL = /[\w.%+-]+@[\w.-]+\.[a-z]{2,}/gi;
const URL_IN_TEXT = /https?:\/\/[^\s"'<>]+|(?<![\w/])(?:\/\/[^\s"'<>/?#]+)?\/[^\s"'<>?#]*[?#][^\s"'<>]*/gi;

function validCpf(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (/^(\d)\1{10}$/.test(digits)) return false;
  for (const length of [9, 10]) {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(digits[i]) * (length + 1 - i);
    if ((sum * 10 % 11) % 10 !== Number(digits[length])) return false;
  }
  return true;
}

function identifiers(value: string): string {
  return value.replace(EMAIL, "[EMAIL]").replace(CPF, (cpf) => validCpf(cpf) ? "[CPF]" : cpf);
}

export function hasPersonalIdentifier(value: string): boolean {
  return identifiers(value) !== value;
}

function redactPath(path: string): string {
  return path.split("/").map((segment) => {
    try {
      const decoded = decodeURIComponent(segment);
      const safe = identifiers(decoded);
      return safe === decoded ? segment : encodeURIComponent(safe);
    } catch {
      return identifiers(segment);
    }
  }).join("/");
}

export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    url.pathname = redactPath(url.pathname);
    return url.toString();
  } catch {
    return "";
  }
}

export function redactText(value: string): string {
  return identifiers(value.replace(URL_IN_TEXT, (url) =>
    /^https?:\/\//i.test(url)
      ? redactUrl(url) || "[URL]"
      : url.startsWith("//") ? (redactUrl(`https:${url}`).slice(6) || "[URL]")
      : redactPath(url.split(/[?#]/, 1)[0]),
  ));
}
