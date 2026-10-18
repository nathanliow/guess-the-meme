"use client";
import { useEffect, useState } from "react";
import { recoverFromLinkConflict, signInWithX } from "@/lib/client";
import { supabase } from "@/lib/supabase";

export default function AuthButton() {
  const [xName, setXName] = useState<string | null>(null);

  useEffect(() => {
    recoverFromLinkConflict();
    const read = async () => {
      const { data } = await supabase.auth.getUser();
      const x = data.user?.identities?.find((i) => i.provider === "x");
      setXName(x ? String(x.identity_data?.user_name ?? x.identity_data?.preferred_username ?? "X") : null);
    };
    read();
    const { data: sub } = supabase.auth.onAuthStateChange(() => void read());
    return () => sub.subscription.unsubscribe();
  }, []);

  if (xName) return <span className="text-sm text-zinc-400">@{xName}</span>;
  return (
    <button onClick={() => signInWithX()} className="rounded-full border border-zinc-700 px-4 py-1.5 text-sm hover:border-zinc-400">
      Sign in with 𝕏
    </button>
  );
}
