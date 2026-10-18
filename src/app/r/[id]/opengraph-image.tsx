import { notFound } from "next/navigation";
import { getShareData } from "@/lib/share";
import { renderCard, size } from "./card";

export { size };
export const contentType = "image/png";
export const alt = "Guess the Meme leaderboard card";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const data = await getShareData((await params).id);
  if (!data) notFound();
  return renderCard(data);
}
