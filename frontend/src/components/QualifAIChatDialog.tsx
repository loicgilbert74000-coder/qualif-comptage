import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQualifAI, type QualifAIContextKey } from "../context/QualifAIContext";

export default function QualifAIChatDialog({
  open,
  context,
  onClose,
}: {
  open: boolean;
  context: QualifAIContextKey;
  onClose: () => void;
}) {
  const { enabled, getMessages, sendMessage } = useQualifAI();
  const messages = getMessages(context.anomalyId);
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [open, messages.length]);

  if (!open) return null;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || !enabled) return;
    sendMessage(context, draft);
    setDraft("");
  }

  const openingMessage = `Bonjour, je suis Qualif IA. Expliquez-moi pourquoi la règle actuelle ne convient pas à ce cas de ${context.fluidType} (${context.subtype}). Je relierai votre explication à la décision que vous enregistrerez.`;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/35 p-4"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="qualif-ai-chat-title"
        className="flex max-h-[min(680px,90vh)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between border-b border-violet-100 bg-gradient-to-r from-violet-50 to-white px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-violet-800">
              <SparkleIcon className="h-5 w-5" />
              <h2 id="qualif-ai-chat-title" className="text-base font-semibold">Conversation avec Qualif IA</h2>
            </div>
            <p className="mt-1 text-xs text-gray-500">{context.meterCode} · {context.fluidType} · {context.subtype}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fermer la conversation" className="rounded-md px-2 py-1 text-gray-500 hover:bg-white hover:text-gray-800">✕</button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto bg-gray-50/70 px-5 py-4">
          <ChatBubble role="assistant" content={openingMessage} />
          {messages.map((message) => (
            <ChatBubble key={message.id} role={message.role} content={message.content} />
          ))}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={submit} className="border-t border-gray-200 bg-white p-4">
          <label htmlFor="qualif-ai-message" className="mb-1.5 block text-xs font-medium text-gray-700">
            Quel contexte doit guider la détection ou la correction ?
          </label>
          <div className="flex items-end gap-2">
            <textarea
              id="qualif-ai-message"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={1200}
              rows={3}
              disabled={!enabled}
              placeholder="Ex. : le site est fermé le week-end; cette baisse est habituelle…"
              className="min-h-[76px] flex-1 resize-y rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none disabled:bg-gray-100"
            />
            <button
              type="submit"
              disabled={!enabled || !draft.trim()}
              className="rounded-lg bg-violet-700 px-3 py-2 text-sm font-medium text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Envoyer
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-4 text-gray-400">
            La mémoire et la conversation restent dans ce navigateur. Une fois la décision enregistrée, le retour pourra guider des suggestions pour des cas comparables.
          </p>
        </form>
      </section>
    </div>
  );
}

function ChatBubble({ role, content }: { role: "user" | "assistant"; content: string }) {
  return (
    <div className={`flex ${role === "user" ? "justify-end" : "justify-start"}`}>
      <p className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-5 ${role === "user" ? "rounded-br-sm bg-geneva-700 text-white" : "rounded-bl-sm border border-violet-100 bg-white text-gray-700 shadow-sm"}`}>
        {content}
      </p>
    </div>
  );
}

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 2.8 14.2 9.8 21.2 12l-7 2.2-2.2 7-2.2-7-7-2.2 7-2.2 2.2-7Z" fill="currentColor" />
    </svg>
  );
}
