// ======================================================
// ForgeOps AI — API: GET /api/orgs/[slug]/repos
//             POST /api/orgs/[slug]/repos — conecta repo
// ======================================================

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getOrgBySlug, connectRepo, getOrgRepos, getUserRole } from "@/lib/tenant";

const ConnectSchema = z.object({
  github_owner: z.string().min(1),
  github_repo: z.string().min(1),
  github_branch: z.string().default("main"),
  github_repo_id: z.number().int().positive(),
  installation_id: z.number().int().optional(),
});

type Params = { params: Promise<{ slug: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const org = await getOrgBySlug(slug);
  if (!org) return NextResponse.json({ error: "Organização não encontrada" }, { status: 404 });

  const role = await getUserRole(user.id, org.id);
  if (!role) return NextResponse.json({ error: "Acesso negado" }, { status: 403 });

  const repos = await getOrgRepos(org.id);
  return NextResponse.json({ repos });
}

export async function POST(req: NextRequest, { params }: Params) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const org = await getOrgBySlug(slug);
  if (!org) return NextResponse.json({ error: "Organização não encontrada" }, { status: 404 });

  const role = await getUserRole(user.id, org.id);
  if (!role || role === "viewer" || role === "member") {
    return NextResponse.json({ error: "Apenas owners e admins podem conectar repos" }, { status: 403 });
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = ConnectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos", details: parsed.error.flatten() }, { status: 422 });
  }

  const result = await connectRepo({
    orgId: org.id,
    githubOwner: parsed.data.github_owner,
    githubRepo: parsed.data.github_repo,
    githubBranch: parsed.data.github_branch,
    githubRepoId: parsed.data.github_repo_id,
    installationId: parsed.data.installation_id,
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  return NextResponse.json({ success: true, repoId: result.repoId }, { status: 201 });
}
