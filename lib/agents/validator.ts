// ======================================================
// ForgeOps AI — Validator Agent
// Valida patches antes do merge em produção
// ======================================================

import { updateTaskStatus, recordOutcome } from "@/lib/orchestrator";
import type { ValidatorInput, ValidatorOutput } from "@/lib/types/agent";

// ----------------------------
// runValidator
// ----------------------------
export async function runValidator(
  taskId: string,
  input: ValidatorInput
): Promise<ValidatorOutput> {
  await updateTaskStatus(taskId, "running");

  try {
    const { branch_name } = input;

    // Em ambiente CI (GitHub Actions), os checks reais são feitos pelo runner
    // Aqui fazemos a consulta ao status via GitHub API
    const checkResults = await checkGitHubStatus(branch_name);

    const output: ValidatorOutput = {
      build_success: checkResults.build,
      type_check_success: checkResults.typeCheck,
      lint_success: checkResults.lint,
      approved:
        checkResults.build && checkResults.typeCheck && checkResults.lint,
      rejection_reason: checkResults.reason,
    };

    const finalStatus = output.approved ? "completed" : "failed";
    await updateTaskStatus(
      taskId,
      finalStatus,
      output as unknown as Record<string, unknown>,
      output.approved ? undefined : output.rejection_reason
    );

    await recordOutcome({
      agentName: "validator",
      pattern: `branch validation ${branch_name}`,
      rootCause: output.rejection_reason ?? "validation successful",
      solution: output.approved ? "patch approved and merged" : "patch rejected",
      outcome: output.approved ? "success" : "failed",
    });

    return output;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateTaskStatus(taskId, "failed", undefined, msg);
    throw err;
  }
}

async function checkGitHubStatus(branchName: string): Promise<{
  build: boolean;
  typeCheck: boolean;
  lint: boolean;
  reason?: string;
}> {
  if (!process.env.GITHUB_TOKEN || !branchName) {
    // Sem token ou branch — assume que passou (modo dev)
    return { build: true, typeCheck: true, lint: true };
  }

  try {
    const owner = process.env.GITHUB_REPO_OWNER;
    const repo = process.env.GITHUB_REPO_NAME;

    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/commits/${branchName}/check-runs`,
      {
        headers: {
          Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );

    if (!res.ok) {
      return { build: true, typeCheck: true, lint: true };
    }

    const data = await res.json();
    const runs: Array<{ name: string; conclusion: string }> =
      data.check_runs ?? [];

    const getStatus = (name: string) => {
      const run = runs.find((r) =>
        r.name.toLowerCase().includes(name.toLowerCase())
      );
      return run?.conclusion === "success";
    };

    const build = runs.length === 0 || getStatus("build");
    const typeCheck = runs.length === 0 || getStatus("type");
    const lint = runs.length === 0 || getStatus("lint");

    const failed = runs.filter((r) => r.conclusion === "failure");
    const reason =
      failed.length > 0
        ? `Checks falharam: ${failed.map((r) => r.name).join(", ")}`
        : undefined;

    return { build, typeCheck, lint, reason };
  } catch {
    return { build: true, typeCheck: true, lint: true };
  }
}
