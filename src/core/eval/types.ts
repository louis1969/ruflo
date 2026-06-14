import type { LLMProvider, RoutingStrategy } from '../../types/index.js';
import type { TaskType } from '../router/types.js';
import type { EvalScoreBreakdown } from '../learning/types.js';

export interface EvalCase {
  id:                string;
  name:              string;
  taskType:          TaskType;
  complexity:        'low' | 'medium' | 'high';
  prompt:            string;
  criteria:          string[];        // rubric items for LLM judge
  expectedKeywords?: string[];        // optional boost if keywords appear
  referenceAnswer?:  string;          // optional golden answer
  tags?:             string[];
}

export interface EvalSuite {
  id:          string;
  name:        string;
  description: string;
  version:     string;
  cases:       EvalCase[];
}

export interface EvalJudgment {
  caseId:    string;
  caseName:  string;
  taskType:  TaskType;
  complexity: string;
  provider:  LLMProvider;
  strategy:  RoutingStrategy;
  output:    string;
  success:   boolean;
  latencyMs: number;
  costUsd:   number;
  scores: {
    ruleBased: number;
    llmJudge:  number | null;
    final:     number;
  };
  breakdown:           EvalScoreBreakdown;
  llmJudgeReasoning?:  string;
  passedCriteria:      string[];
  failedCriteria:      string[];
  passed:              boolean;          // final score >= PASS_THRESHOLD
}

export interface ProviderRunStats {
  cases:        number;
  passed:       number;
  passRate:     number;
  avgScore:     number;
  avgLatencyMs: number;
  totalCostUsd: number;
}

export interface EvalRun {
  id:        string;
  suiteId:   string;
  suiteName: string;
  runAt:     number;
  strategy:  RoutingStrategy;
  judgments: EvalJudgment[];
  summary: {
    totalCases:   number;
    passed:       number;
    passRate:     number;
    avgScore:     number;
    avgLatencyMs: number;
    totalCostUsd: number;
    byProvider:   Record<string, ProviderRunStats>;
    byTaskType:   Record<string, { cases: number; avgScore: number; passRate: number }>;
  };
}

export interface EvalComparison {
  baseRunId:     string;
  compareRunId:  string;
  scoreDelta:    number;
  passRateDelta: number;
  costDelta:     number;
  latencyDelta:  number;
  improved:      string[];
  regressed:     string[];
}

export interface EvalReport {
  run:             EvalRun;
  comparison?:     EvalComparison;
  recommendations: string[];
}
