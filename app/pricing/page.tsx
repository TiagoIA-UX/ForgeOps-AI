// Server Component wrapper — garante Suspense p/ useSearchParams()
import { Suspense } from "react";
import PricingClient from "./PricingClient";
import { Loader2 } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Preços — ZAEA",
  description: "Automatize correção de bugs no seu repositório GitHub. Sem cartão para começar.",
};

export default function PricingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-zaea-bg flex items-center justify-center">
          <Loader2 size={32} className="animate-spin text-zaea-accent" />
        </div>
      }
    >
      <PricingClient />
    </Suspense>
  );
}
