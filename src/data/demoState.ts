import type { CohostState } from "../lib/pythonEngineBridge.js";

// No se de donde salio este archivo.
export const demoState: CohostState = {
  engine: {
    mode: "demo",
    readiness: "ready",
    label: "Local engine ready",
    detail: "Ollama + agenda controller attached in demo mode"
  },
  kira: {
    name: "Kira",
    mood: "focused",
    currentAction: "Conducting the stream agenda"
  },
  agenda: {
    activeTitle: "Can small local models host a real stream?",
    activeGoal:
      "Explain the premise, compare risks, then ask the operator whether to continue or pivot.",
    elapsedSeconds: 496,
    queue: [
      "Why agenda control matters more than endless autonomy",
      "How context cards reduce hallucination",
      "When the operator should take over"
    ]
  },
  cards: [
    {
      title: "Approved context",
      source: "Editorial card",
      summary: "OpenCohost uses curated cards as bounded context for the current topic."
    },
    {
      title: "Guardrail reminder",
      source: "Runtime policy",
      summary: "Kira should not invent sources, promise unsupported features, or ignore the agenda."
    },
    {
      title: "Demo hook",
      source: "Operator note",
      summary: "The creator steps away for tacos while Kira continues prepared topics."
    }
  ],
  guardrails: [
    { label: "Agenda locked", state: "ok" },
    { label: "Approved cards only", state: "ok" },
    { label: "Operator takeover", state: "ok" },
    { label: "Raw chat isolated", state: "watch" }
  ],
  transcript: [
    {
      speaker: "Kira",
      text: "I will continue with the approved topic: this is about keeping direction, not talking forever."
    },
    {
      speaker: "Operator",
      text: "If chat asks something off-topic, keep it queued for later."
    }
  ]
};
