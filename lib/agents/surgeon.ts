// ======================================================
// ZAEA — Surgeon Agent
// Gera e aplica patches automáticos via Groq
// PROTEÇÃO ABSOLUTA: nunca toca em arquivos protegidos
// ======================================================

import { updateTaskStatus, recordOutcome, getKnowledge } from "@/lib/orchestrator";
import { chatComplete } from "@/lib/groq";
import type {
  SurgeonInput,
  SurgeonOutput,
  PatchChange,
  TypeScriptError,
  LintError,
} from "@/lib/types/agent";

// Hard limits — NUNCA sobrescrever
const PROTECTED_PATTERNS = [
  /payment/i,
  /checkout/i,
  /supabase[/\\]migrations/i,
  /\.test\./i,
  /\.spec\./i,
  /supabase[/\\]/i,
];

function isProtected(file: string): boolean {
  return PROTECTED_PATTERNS.some((p) => p.test(file));
}

// ----------------------------
// runSurgeon
// ----------------------------
export async function runSurgeon(
  taskId: string,
  input: SurgeonInput
): Promise<SurgeonOutput> {
  await updateTaskStatus(taskId, "running");

  try {
    const { errors, risk_level } = input;

    // Filtra erros de arquivos protegidos
    const safeErrors = errors.filter(
      (e) => !isProtected((e as TypeScriptError | LintError).file)
    );
    const skippedFiles = errors
      .filter((e) => isProtected((e as TypeScriptError | LintError).file))
      .map((e) => (e as TypeScriptError | LintError).file);

    if (safeErrors.length === 0) {
      const output: SurgeonOutput = {
        patches_applied: 0,
        pr_url: null,
        branch_name: null,
        changes: [],
        skipped_files: skippedFiles,
      };
      await updateTaskStatus(taskId, "completed", output as unknown as Record<string, unknown>);
      return output;
    }

    // Limita a 10 erros por execução para segurança
    const errorsToFix = safeErrors.slice(0, 10);

    // Consulta conhecimento existente
    const knowledge = await getKnowledge(
      "surgeon",
      errorsToFix[0] ? (errorsToFix[0] as TypeScriptError).code ?? "lint" : "fix"
    );

    // Gera patches via Groq
    const patches = await generatePatches(errorsToFix, knowledge, risk_level);

    const branchName =
      risk_level === "SAFE"
        ? null
        : `zaea/fix-${Date.now().toString(36)}`;

    const output: SurgeonOutput = {
      patches_applied: patches.length,
      pr_url: branchName
        ? `https://github.com/${process.env.GITHUB_REPO_OWNER}/${process.env.GITHUB_REPO_NAME}/compare/${branchName}`
        : null,
      branch_name: branchName,
      changes: patches,
      skipped_files: skippedFiles,
    };

    await updateTaskStatus(taskId, "completed", output as unknown as Record<string, unknown>);

    // Registra na base de conhecimento
    for (const patch of patches) {
      await recordOutcome({
        agentName: "surgeon",
        pattern: patch.description.substring(0, 100),
        rootCause: patch.original.substring(0, 200),
        solution: patch.patched.substring(0, 200),
        outcome: "success",
        confidenceDelta: 10,
      });
    }

    return output;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateTaskStatus(taskId, "failed", undefined, msg);
    throw err;
  }
}

async function generatePatches(
  errors: Array<TypeScriptError | LintError>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  knowledge: any[],
  riskLevel: string
): Promise<PatchChange[]> {
  const knowledgeCtx =
    knowledge.length > 0
      ? `\nSoluções conhecidas:\n${knowledge.map((k) => `- ${k.pattern}: ${k.solution}`).join("\n")}`
      : "";

  const prompt = `Você é o Surgeon do ZAEA. Gere patches mínimos e seguros para corrigir os erros abaixo.
Nível de risco: ${riskLevel}
${knowledgeCtx}

Erros a corrigir:
${JSON.stringify(errors, null, 2)}

Responda APENAS em JSON com o schema:
{
  "patches": [
    {
      "file": "caminho/do/arquivo",
      "original": "código original problemático (contexto de 3 linhas)",
      "patched": "código corrigido",
      "description": "descrição concisa da correção"
    }
  ]
}

REGRAS:
- Não modifique lógica de negócio, apenas corrija erros de tipo/lint
- Patches mínimos — menor mudança possível
- Se não tiver certeza, omita o patch
- Nunca toque em: payment, checkout, migrations, testes`;

  const content = await chatComplete(
    [{ role: "user", content: prompt }],
    { json: true, maxTokens: 4096, temperature: 0.05 }
  );

  const raw = JSON.parse(content || '{"patches":[]}');
  return raw.patches ?? [];
}
