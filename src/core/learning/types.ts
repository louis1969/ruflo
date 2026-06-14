import type { LLMProvider, LearningMode } from '../../types/index.js';
import type { TaskType } from '../router/types.js';

export interface EvalScoreBreakdown {
  completeness:   number; // 0-1 — non-empty, length vs complexity
  errorFree:      number; // 0-1 — absence of apology / error signals
  taskAlignment:  number; // 0-1 — keyword overlap with instruction
  coherence:      number; // 0-1 — task-type-specific structure
}

export interface EvalResult {
  taskId:        string;
  jobId:         string;
  agentName:     string;
  provider:      LLMProvider;
  taskType:      TaskType;
  qualityScore:  number;          // weighted avg of breakdown — 0-1
  breakdown:     EvalScoreBreakdown;
  evaluatorType: 'rule-based' | 'llm-judge';
  scoredAt:      number;
}

// Calibration data produced by the heuristic updater and consumed by HeuristicStore.
export interface CalibrationEntry {
  provider:    LLMProvider;
  taskType:    TaskType;
  avgQuality:  number;
  sampleCount: number;
}

export interface FailurePattern {
  agentName:   string;
  taskType:    TaskType;
  kind:        'empty-output' | 'low-completeness' | 'low-alignment' | 'poor-structure' | 'error-signal';
  frequency:   number;           // count of occurrences in the analysis window
  examples:    string[];         // up to 3 truncated instruction snippets
}

export interface PromptCandidate {
  agentName:      string;
  taskType:       TaskType;
  hint:           string;        // structured improvement hint (human-readable)
  pattern:        FailurePattern;
  generatedAt:    number;
  status:         'candidate' | 'active' | 'rejected';
  evalScore:      number | null; // filled in after shadow evaluation
}

export interface ProviderMetrics {
  provider:       LLMProvider;
  callCount:      number;
  successRate:    number;
  avgQuality:     number | null; // null = not yet evaluated
  avgLatencyMs:   number;
  totalCostUsd:   number;
  byTaskType:     Partial<Record<TaskType, { calls: number; avgQuality: number | null }>>;
}

export interface MetricsSnapshot {
  timestamp:            number;
  windowJobCount:       number;   // jobs in this analysis window
  providers:            ProviderMetrics[];
  topProviderByTask:    Partial<Record<TaskType, LLMProvider>>;
  overall: {
    successRate:        number;
    avgQuality:         number | null;
    totalCostUsd:       number;
    avgLatencyMs:       number;
    evalCoverage:       number; // fraction of results that have been quality-scored
  };
  heuristicUpdateCount: number;
}

export interface LearningReport {
  runAt:                      number;
  mode:                       LearningMode;
  jobsAnalyzed:               number;
  resultsScored:              number;
  heuristicUpdates:           number;
  calibrationEntries:         number;
  promptCandidatesGenerated:  number;
  snapshot:                   MetricsSnapshot;
  recommendations:            string[];
}
