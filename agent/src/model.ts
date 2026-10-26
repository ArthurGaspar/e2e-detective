/**
 * Failure classifier: multinomial logistic regression on standardized features,
 * trained with full-batch gradient descent and L2 regularization.
 *
 * Small and dependency-free, and its weights read directly as "how much does
 * this clue point at this cause", which the dashboard shows. It is always
 * compared with `rulesVerdict`, the checklist a QA engineer would apply by hand.
 */
import { CAUSES, type Cause } from "./scenarios";
import { FEATURES, type FeatureVector, toArray } from "./features";

export interface Sample {
  features: FeatureVector;
  cause: Cause;
}

export interface Model {
  features: readonly string[];
  classes: Cause[];
  mean: number[];
  std: number[];
  /** weights[class][feature]; bias[class] */
  weights: number[][];
  bias: number[];
  trainedOn: number;
  metrics?: Metrics;
}

export interface Metrics {
  samples: number;
  folds: number;
  accuracy: number;
  rulesAccuracy: number;
  majorityAccuracy: number;
  /** confusion[actual][predicted], in CAUSES order */
  confusion: number[][];
  perClass: Record<Cause, { precision: number; recall: number; support: number }>;
}

const softmax = (z: number[]) => {
  const m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
};

export function train(samples: Sample[], { epochs = 800, lr = 0.3, l2 = 0.01 } = {}): Model {
  const X = samples.map((s) => toArray(s.features));
  const y = samples.map((s) => CAUSES.indexOf(s.cause));
  const d = FEATURES.length;
  const k = CAUSES.length;
  const mean = Array.from({ length: d }, (_, j) => X.reduce((s, r) => s + r[j], 0) / Math.max(1, X.length));
  const std = Array.from({ length: d }, (_, j) => {
    const v = X.reduce((s, r) => s + (r[j] - mean[j]) ** 2, 0) / Math.max(1, X.length);
    return Math.sqrt(v) || 1;
  });
  const Z = X.map((r) => r.map((v, j) => (v - mean[j]) / std[j]));
  const W = Array.from({ length: k }, () => new Array<number>(d).fill(0));
  const b = new Array<number>(k).fill(0);

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gW = Array.from({ length: k }, () => new Array<number>(d).fill(0));
    const gb = new Array<number>(k).fill(0);
    for (let i = 0; i < Z.length; i++) {
      const p = softmax(W.map((w, c) => b[c] + w.reduce((s, wj, j) => s + wj * Z[i][j], 0)));
      for (let c = 0; c < k; c++) {
        const err = p[c] - (y[i] === c ? 1 : 0);
        gb[c] += err;
        for (let j = 0; j < d; j++) gW[c][j] += err * Z[i][j];
      }
    }
    const n = Math.max(1, Z.length);
    for (let c = 0; c < k; c++) {
      b[c] -= (lr * gb[c]) / n;
      for (let j = 0; j < d; j++) W[c][j] -= lr * (gW[c][j] / n + l2 * W[c][j]);
    }
  }
  return { features: FEATURES, classes: CAUSES, mean, std, weights: W, bias: b, trainedOn: samples.length };
}

export function predict(model: Model, f: FeatureVector): Record<Cause, number> {
  const z = toArray(f).map((v, j) => (v - model.mean[j]) / model.std[j]);
  const p = softmax(model.weights.map((w, c) => model.bias[c] + w.reduce((s, wj, j) => s + wj * z[j], 0)));
  return Object.fromEntries(model.classes.map((c, i) => [c, Math.round(p[i] * 1000) / 1000])) as Record<Cause, number>;
}

export const topCause = (p: Record<Cause, number>): Cause =>
  (Object.entries(p) as [Cause, number][]).sort((a, b) => b[1] - a[1])[0][0];

/** The checklist a person would use without a model. */
export function rulesVerdict(f: FeatureVector): Cause {
  if (f.passed_on_retry || f.requests_pending > 0) return "flaky";
  if (f.api_5xx > 0 || f.requests_failed > 0) return "environment";
  if (f.element_missing && f.heal_score >= 0.3) return "outdated_test";
  return "real_bug";
}

/** K-fold cross-validation over a seeded shuffle, so the reported metrics are reproducible. */
export function evaluate(samples: Sample[], folds = 5, seed = 1): Metrics {
  const order = samples.map((_, i) => i);
  let s = seed;
  for (let i = order.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    const j = Math.floor((s / 2 ** 32) * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const k = CAUSES.length;
  const confusion = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  let correct = 0;
  let rulesCorrect = 0;
  for (let f = 0; f < folds; f++) {
    const test = order.filter((_, i) => i % folds === f).map((i) => samples[i]);
    const trainSet = order.filter((_, i) => i % folds !== f).map((i) => samples[i]);
    if (!test.length || !trainSet.length) continue;
    const m = train(trainSet);
    for (const s of test) {
      const pred = topCause(predict(m, s.features));
      confusion[CAUSES.indexOf(s.cause)][CAUSES.indexOf(pred)]++;
      if (pred === s.cause) correct++;
      if (rulesVerdict(s.features) === s.cause) rulesCorrect++;
    }
  }
  const counts = CAUSES.map((c) => samples.filter((s) => s.cause === c).length);
  const perClass = Object.fromEntries(
    CAUSES.map((c, i) => {
      const tp = confusion[i][i];
      const predicted = confusion.reduce((s, row) => s + row[i], 0);
      return [c, { precision: predicted ? tp / predicted : 0, recall: counts[i] ? tp / counts[i] : 0, support: counts[i] }];
    }),
  ) as Metrics["perClass"];
  const n = Math.max(1, samples.length);
  return {
    samples: samples.length,
    folds,
    accuracy: correct / n,
    rulesAccuracy: rulesCorrect / n,
    majorityAccuracy: Math.max(...counts) / n,
    confusion,
    perClass,
  };
}
