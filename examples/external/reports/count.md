# Trace investigation

Input: count.zip

SHA-256: 6a57313717a0b0b4202bd6783ec042dc5e19f42ce4fabd3984756b6dfe9354c8

Status: failures_observed

## F1: assertion_mismatch

The observed value did not match the test's expectation.

Certainty: observed

Action: Expect "toHaveText"

Source: E:\Bibliotecas\Documentos\PROGRAMMING\2026\github\e2e-detective\examples\external\todomvc.spec.ts:11:45

Locator:

```text
locator('.todo-count')
```

Evidence: test.trace:25 (mfro@58)

```text
Error: expect(locator).toHaveText(expected) failed

Locator:  locator('.todo-count')
Expected: "2 items left"
Received: "1 item left"
Timeout:  1500ms

Call log:
  - Expect "toHaveText" locator('.todo-count') with timeout 1500ms
  - waiting for locator('.todo-count')
    15 × locator resolved to <span class="todo-count" data-testid="todo-count">…</span>
       - unexpected value "1 item left"

```

Suggestions (review required):

- Compare the expected and received values with the setup steps and product requirements. Correct the assertion only if its expectation is wrong; otherwise investigate the application state.

## Context

Network requests:

```text
[
  {
    "url": "https://demo.playwright.dev/todomvc/base.css",
    "status": 200,
    "durationMs": 24.265,
    "failure": null,
    "source": {
      "entry": "1-trace.network",
      "line": 1
    }
  },
  {
    "url": "https://demo.playwright.dev/todomvc/index.css",
    "status": 200,
    "durationMs": 24.556,
    "failure": null,
    "source": {
      "entry": "1-trace.network",
      "line": 2
    }
  },
  {
    "url": "https://demo.playwright.dev/todomvc/js/director.js",
    "status": 200,
    "durationMs": 24.378,
    "failure": null,
    "source": {
      "entry": "1-trace.network",
      "line": 3
    }
  },
  {
    "url": "https://demo.playwright.dev/todomvc/",
    "status": 200,
    "durationMs": 64.687,
    "failure": null,
    "source": {
      "entry": "1-trace.network",
      "line": 4
    }
  },
  {
    "url": "https://demo.playwright.dev/todomvc/js/bundle.js",
    "status": 200,
    "durationMs": 57.954,
    "failure": null,
    "source": {
      "entry": "1-trace.network",
      "line": 5
    }
  }
]
```

Console errors:

```text
None recorded
```

## Warnings

## Limits

- Diagnoses describe recorded symptoms; a single trace does not establish root cause or flakiness.

- No failure observed does not prove the test passed. Library-only traces can omit assertions and test-level errors.

- The lab-trained classifier is not used for external traces. Suggestions require human review and never edit source files.

- URLs in network context omit credentials, queries and fragments; error messages and source paths may still contain private data.

- Playwright trace metadata is an internal format; missing or unsupported records can limit this report.

