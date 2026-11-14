import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { CorrectionOption } from "../types";

const STORAGE_KEY = "qualif-comptage.qualif-ia.v1";

type Decision = "validee" | "corrigee";
type ChatRole = "user" | "assistant";

export interface QualifAIContextKey {
  anomalyId: string;
  meterCode: string;
  fluidType: string;
  role: string;
  subtype: string;
}

interface LearnedDecision extends QualifAIContextKey {
  id: string;
  decision: Decision;
  method?: string;
  comment?: string;
  rationale?: string;
  createdAt: string;
}

export interface QualifAIChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
}

interface QualifAIMemory {
  enabled: boolean;
  suggestionsEnabled: boolean;
  decisions: LearnedDecision[];
  conversations: Record<string, QualifAIChatMessage[]>;
}

export interface LearnedSuggestion {
  kind: "detection" | "correction";
  title: string;
  explanation: string;
  method?: string;
  examples: number;
}

interface QualifAIValue {
  enabled: boolean;
  suggestionsEnabled: boolean;
  learnedDecisionCount: number;
  setEnabled: (value: boolean) => void;
  setSuggestionsEnabled: (value: boolean) => void;
  recordDecision: (decision: Omit<LearnedDecision, "id" | "createdAt" | "rationale">) => void;
  getMessages: (anomalyId: string) => QualifAIChatMessage[];
  getLatestUserMessage: (anomalyId: string) => string | undefined;
  sendMessage: (context: QualifAIContextKey, content: string) => void;
  getSuggestion: (
    context: Omit<QualifAIContextKey, "anomalyId" | "meterCode">,
    options: CorrectionOption[]
  ) => LearnedSuggestion | null;
}

const QualifAIContext = createContext<QualifAIValue | null>(null);

function emptyMemory(): QualifAIMemory {
  return { enabled: true, suggestionsEnabled: true, decisions: [], conversations: {} };
}

function readMemory(): QualifAIMemory {
  if (typeof window === "undefined") return emptyMemory();
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null") as Partial<QualifAIMemory> | null;
    return {
      enabled: typeof parsed?.enabled === "boolean" ? parsed.enabled : true,
      suggestionsEnabled: typeof parsed?.suggestionsEnabled === "boolean" ? parsed.suggestionsEnabled : true,
      decisions: Array.isArray(parsed?.decisions) ? parsed.decisions.slice(-300) : [],
      conversations: parsed?.conversations && typeof parsed.conversations === "object" ? parsed.conversations : {},
    };
  } catch {
    return emptyMemory();
  }
}

function fold(value: string): string {
  return value.toLocaleLowerCase("fr").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function assistantReply(content: string, context: QualifAIContextKey): string {
  const text = fold(content);
  let reason = "votre contexte métier";
  if (/travaux|chantier|maintenance|fermeture|arret/.test(text)) reason = "les travaux ou l’arrêt du site";
  else if (/week[- ]?end|samedi|dimanche/.test(text)) reason = "le profil d’activité du week-end";
  else if (/remplacement|remis a zero|remise a zero|nouveau compteur/.test(text)) reason = "le remplacement ou la remise à zéro du compteur";
  else if (/meteo|temperature|soleil|rayonnement|nuage/.test(text)) reason = "les conditions météorologiques";

  return `Merci, je mémorise votre retour sur ${reason} pour ${context.fluidType} · ${context.subtype}. Après votre décision, ce cas pourra orienter les suggestions pour des situations comparables. La décision reste sous votre contrôle.`;
}

export function QualifAIProvider({ children }: { children: ReactNode }) {
  const [memory, setMemory] = useState<QualifAIMemory>(readMemory);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(memory));
    } catch {
      // The interface remains usable if browser storage is unavailable.
    }
  }, [memory]);

  const value = useMemo<QualifAIValue>(() => ({
    enabled: memory.enabled,
    suggestionsEnabled: memory.suggestionsEnabled,
    learnedDecisionCount: memory.decisions.length,
    setEnabled: (enabled) => setMemory((current) => ({ ...current, enabled })),
    setSuggestionsEnabled: (suggestionsEnabled) => setMemory((current) => ({ ...current, suggestionsEnabled })),
    recordDecision: (decision) => setMemory((current) => {
      if (!current.enabled) return current;
      const latestUserMessage = [...(current.conversations[decision.anomalyId] ?? [])]
        .reverse()
        .find((message) => message.role === "user")?.content;
      const rationale = [...new Set([decision.comment, latestUserMessage].filter(Boolean))].join(" · ") || undefined;
      const learned: LearnedDecision = {
        ...decision,
        id: window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
        rationale,
        createdAt: new Date().toISOString(),
      };
      return { ...current, decisions: [...current.decisions, learned].slice(-300) };
    }),
    getMessages: (anomalyId) => memory.conversations[anomalyId] ?? [],
    getLatestUserMessage: (anomalyId) => [...(memory.conversations[anomalyId] ?? [])]
      .reverse()
      .find((message) => message.role === "user")?.content,
    sendMessage: (context, content) => setMemory((current) => {
      if (!current.enabled || !content.trim()) return current;
      const existing = current.conversations[context.anomalyId] ?? [];
      const userMessage: QualifAIChatMessage = {
        id: `${Date.now()}-user`, role: "user", content: content.trim(), createdAt: new Date().toISOString(),
      };
      const reply: QualifAIChatMessage = {
        id: `${Date.now()}-assistant`, role: "assistant", content: assistantReply(content.trim(), context), createdAt: new Date().toISOString(),
      };
      return {
        ...current,
        conversations: { ...current.conversations, [context.anomalyId]: [...existing, userMessage, reply].slice(-40) },
      };
    }),
    getSuggestion: (context, options) => {
      if (!memory.enabled || !memory.suggestionsEnabled) return null;
      const samePattern = memory.decisions.filter((decision) =>
        fold(decision.fluidType) === fold(context.fluidType)
        && fold(decision.role) === fold(context.role)
        && fold(decision.subtype) === fold(context.subtype)
      );
      if (!samePattern.length) return null;

      const votes = new Map<string, { count: number; latest: string; decision: LearnedDecision }>();
      for (const decision of samePattern) {
        const key = decision.decision === "validee" ? "validee" : `corrigee:${decision.method ?? ""}`;
        const current = votes.get(key);
        votes.set(key, {
          count: (current?.count ?? 0) + 1,
          latest: decision.createdAt > (current?.latest ?? "") ? decision.createdAt : current?.latest ?? decision.createdAt,
          decision: !current || decision.createdAt >= current.latest ? decision : current.decision,
        });
      }
      const ranked = [...votes.entries()].sort((a, b) => b[1].count - a[1].count || b[1].latest.localeCompare(a[1].latest));
      for (const [key, vote] of ranked) {
        if (key === "validee") {
          const reason = (vote.decision.rationale || vote.decision.comment || "").trim();
          return {
            kind: "detection",
            title: "Contexte légitime déjà rencontré",
            explanation: `${vote.count} cas comparable(s) ont été conservés en l’état.${reason ? ` Motif partagé : « ${reason.slice(0, 150)} ».` : " Vérifiez ce contexte avant de corriger."}`,
            examples: vote.count,
          };
        }
        const method = key.slice("corrigee:".length);
        const option = options.find((candidate) => candidate.method === method && candidate.eligible);
        if (option) {
          return {
            kind: "correction",
            title: `Correction souvent retenue : ${option.label}`,
            explanation: `Choisie dans ${vote.count} cas comparable(s) pour ${context.fluidType} · ${context.subtype}. Le score de fiabilité de ce cas reste vérifié avant application.`,
            method,
            examples: vote.count,
          };
        }
      }
      return null;
    },
  }), [memory]);

  return <QualifAIContext.Provider value={value}>{children}</QualifAIContext.Provider>;
}

export function useQualifAI(): QualifAIValue {
  const value = useContext(QualifAIContext);
  if (!value) throw new Error("useQualifAI doit être utilisé dans QualifAIProvider.");
  return value;
}
