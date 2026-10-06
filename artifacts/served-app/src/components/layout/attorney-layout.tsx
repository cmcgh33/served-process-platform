import { ReactNode } from "react";
import { AttorneySidebar } from "./attorney-sidebar";

export function AttorneyLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <AttorneySidebar />
      <main className="flex-1 overflow-y-auto bg-brand-canvas">
        <div className="p-8 max-w-5xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
