import type { CSSProperties, ReactElement } from "react";

interface ConfettiParticle {
  color: string;
  delay: number;
  rotation: string;
  x: string;
  y: string;
}

interface ConfettiParticleStyle extends CSSProperties {
  "--confetti-rotation": string;
  "--confetti-x": string;
  "--confetti-y": string;
}

const PARTICLES: ConfettiParticle[] = [
  { x: "-270px", y: "-145px", rotation: "-210deg", delay: 0, color: "#d5a84b" },
  { x: "-220px", y: "-205px", rotation: "150deg", delay: 35, color: "#ca6b4c" },
  {
    x: "-175px",
    y: "-120px",
    rotation: "-120deg",
    delay: 70,
    color: "#5b7fc4",
  },
  {
    x: "-130px",
    y: "-235px",
    rotation: "260deg",
    delay: 15,
    color: "var(--success-bright)",
  },
  { x: "-82px", y: "-165px", rotation: "-250deg", delay: 95, color: "#d87ba6" },
  {
    x: "-35px",
    y: "-245px",
    rotation: "190deg",
    delay: 45,
    color: "var(--accent)",
  },
  { x: "28px", y: "-220px", rotation: "-175deg", delay: 80, color: "#d5a84b" },
  { x: "76px", y: "-150px", rotation: "235deg", delay: 20, color: "#5b7fc4" },
  {
    x: "122px",
    y: "-235px",
    rotation: "-280deg",
    delay: 105,
    color: "#ca6b4c",
  },
  {
    x: "168px",
    y: "-125px",
    rotation: "165deg",
    delay: 55,
    color: "var(--success-bright)",
  },
  { x: "215px", y: "-205px", rotation: "-225deg", delay: 10, color: "#d87ba6" },
  {
    x: "275px",
    y: "-140px",
    rotation: "290deg",
    delay: 90,
    color: "var(--accent)",
  },
  { x: "-245px", y: "-75px", rotation: "135deg", delay: 120, color: "#5b7fc4" },
  {
    x: "-150px",
    y: "-85px",
    rotation: "-190deg",
    delay: 135,
    color: "#d87ba6",
  },
  { x: "145px", y: "-80px", rotation: "220deg", delay: 125, color: "#d5a84b" },
  { x: "240px", y: "-70px", rotation: "-155deg", delay: 140, color: "#ca6b4c" },
];

export function OnboardingConfetti(): ReactElement {
  return (
    <span className="onboarding-confetti" aria-hidden="true">
      {PARTICLES.map((particle, index) => (
        <span
          key={index}
          className="onboarding-confetti-particle"
          style={
            {
              "--confetti-x": particle.x,
              "--confetti-y": particle.y,
              "--confetti-rotation": particle.rotation,
              animationDelay: `${particle.delay}ms`,
              background: particle.color,
            } as ConfettiParticleStyle
          }
        />
      ))}
    </span>
  );
}
