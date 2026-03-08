import { Suspense } from "react";
import { GradMeApp } from "@/components/gradme/gradme-app";
import { QueryProvider } from "@/components/gradme/query-provider";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <QueryProvider>
      <Suspense>
        <GradMeApp />
      </Suspense>
    </QueryProvider>
  );
}
