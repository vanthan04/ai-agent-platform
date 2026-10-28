import type { ReactNode } from "react";
import { SetupNav } from "@/components/setup/SetupNav";

export default function SetupLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <SetupNav />
      {children}
    </div>
  );
}
