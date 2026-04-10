// ======================================================
// ZAEA — Scanner Agent
// Detecta erros de TypeScript, lint e build via GitHub
// ======================================================

import { updateTaskStatus, recordOutcome, getKnowledge } from "@/lib/orchestrator";
import { chatComplete } from "@/lib/groq";
import type {
  ScannerInput,
  ScannerOutput,
  TypeScriptError,
  LintError,
  RiskLevel,
} from "@/lib/types/agent";

// Arquivos protegidos — nunca reportados como auto-fix
const PROTECTED_FILES = [
  "payment",
  "checkout",
  "supabase/migrations",
  ".test.",
  ".spec.",
];

function isProtected(file: string): boolean {
  return PROTECTED_FILES.some((p) => file.toLowerCase().includes(p));
}

function classifyRisk(
  tsErrors: TypeScriptError[],
  lintErrors: LintError[]
): RiskLevel {
  const errorCount = tsErrors.length + lintErrors.filter((e) => e.severity === "error").length;
  const touchesProtected = [...tsErrors, ...lintErrors].some((e) =>
    isProtected(e.file)
  );

  if (touchesProtected || errorCount > 20) return "RISKY";
  if (errorCount > 5) return "MODERATE";
  return "SAFE";
}

// ----------------------------
// runScanner
// ----------------------------
export async function runScanner(
  taskId: string,
  input: ScannerInput
): Promise<ScannerOutput> {
  await updateTaskStatus(taskId, "running");

  try {
    // Consulta base de conhecimento para padrões conhecidos
    const knowledge = await getKnowledge("scanner", "typescript build error");

    // Usa Groq para analisar o contexto do commit/sha
    const prompt = buildScanPrompt(input, knowledge);
    const content = await chatComplete(
      [
        {
          role: "system",
          content: `Você é o Scanner do ZAEA. Analise erros de TypeScript e lint em projetos Next.js.
Responda SEMPRE em JSON válido com o schema: {
  "typescript_errors": [{"file": string, "line": number, "column": number, "code": string, "message": string}],
  "lint_errors": [{"file": string, "line": number, "rule": string, "message": string, "severity": "error"|"warning"}],
  "summary": string
}`,
        },
        { role: "user", content: prompt },
      ],
      { json: true, maxTokens: 2048, temperature: 0.1 }
    );

    const raw = JSON.parse(content || "{}");
    const tsErrors: TypeScriptError[] = (raw.typescript_errors ?? []).filter(
      (e: TypeScriptError) => !isProtected(e.file)
    );
    const lintErrors: LintError[] = (raw.lint_errors ?? []).filter(
      (e: LintError) => !isProtected(e.file)
    );
    const riskLevel = classifyRisk(tsErrors, lintErrors);

    const output: ScannerOutput = {
      errors_found: tsErrors.length + lintErrors.length,
      typescript_errors: tsErrors,
      lint_errors: lintErrors,
      risk_level: riskLevel,
      summary: raw.summary ?? "Scan concluído",
    };

    await updateTaskStatus(taskId, "completed", output as unknown as Record<string, unknown>);

    // Registra padrão na base de conhecimento
    if (output.errors_found > 0) {
      await recordOutcome({
        agentName: "scanner",
        pattern: `${tsErrors[0]?.code ?? lintErrors[0]?.rule ?? "unknown"} error`,
        rootCause: tsErrors[0]?.message ?? lintErrors[0]?.message ?? "unknown",
        solution: `Found ${output.errors_found} errors with risk ${riskLevel}`,
        outcome: "success",
      });
    }

    return output;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateTaskStatus(taskId, "failed", undefined, msg);
    throw err;
  }
}

function buildScanPrompt(
  input: ScannerInput,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  knowledge: any[]
): string {
  const knowledgeCtx =
    knowledge.length > 0
      ? `\nPadrões conhecidos:\n${knowledge.map((k) => `- ${k.pattern}: ${k.solution} (confiança: ${k.confidence}%)`).join("\n")}`
      : "";

  return `Analise o seguinte estado de build para o commit ${input.sha ?? "HEAD"}:
${input.target_files ? `Arquivos alvo: ${input.target_files.join(", ")}` : "Projeto completo"}
${knowledgeCtx}

Retorne os erros encontrados em JSON conforme o schema especificado.
Se não houver erros, retorne arrays vazios.`;
}
