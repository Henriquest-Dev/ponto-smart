import type { Metadata } from "next";
import { Onboarding } from "./onboarding";

export const metadata: Metadata = { title: "Apresentação", description: "Como funciona o Horbit em três passos." };

export default function OnboardingPage() {
  return <Onboarding />;
}
