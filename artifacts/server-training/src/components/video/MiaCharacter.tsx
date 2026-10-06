import { motion } from "framer-motion";

const SKIN = "#f4c896";
const HAIR = "#3b1f0e";

export function MiaCharacter({
  className = "",
  pose = "default",
  expression = "smile",
}: {
  className?: string;
  pose?: "default" | "point-right" | "phone" | "waving";
  expression?: "smile" | "talking";
}) {
  return (
    <div className={`relative ${className}`}>
      <svg viewBox="0 0 200 400" className="w-full h-full drop-shadow-lg" preserveAspectRatio="xMidYMid meet">
        {/* Shadow */}
        <ellipse cx="100" cy="380" rx="40" ry="10" fill="rgba(0,0,0,0.1)" />

        {/* Legs / Jeans */}
        <path d="M 85 220 L 70 370 L 95 370 L 100 220 Z" fill="#3b82f6" />
        <path d="M 115 220 L 100 220 L 105 370 L 130 370 Z" fill="#2563eb" />

        {/* Shoes */}
        <path d="M 65 370 L 95 370 L 95 385 L 60 385 Z" fill="#333" />
        <path d="M 105 370 L 135 370 L 140 385 L 105 385 Z" fill="#111" />

        {/* Torso / Navy Shirt */}
        <path d="M 75 110 L 125 110 L 135 230 L 65 230 Z" fill="#0f1e3c" />

        {/* SERVED. Logo on Shirt */}
        <text x="100" y="150" fill="#f59e0b" fontSize="14" fontWeight="bold" textAnchor="middle" letterSpacing="1">SERVED.</text>

        {/* Arms */}
        {pose === "default" && (
          <>
            <path d="M 70 120 C 50 160, 50 200, 60 230" fill="none" stroke={SKIN} strokeWidth="16" strokeLinecap="round" />
            <path d="M 130 120 C 150 160, 150 200, 140 230" fill="none" stroke={SKIN} strokeWidth="16" strokeLinecap="round" />
          </>
        )}
        {pose === "point-right" && (
          <>
            <path d="M 70 120 C 50 160, 50 200, 60 230" fill="none" stroke={SKIN} strokeWidth="16" strokeLinecap="round" />
            <path d="M 130 120 C 160 110, 180 130, 190 120" fill="none" stroke={SKIN} strokeWidth="16" strokeLinecap="round" />
          </>
        )}
        {pose === "phone" && (
          <>
            <path d="M 70 120 C 50 160, 80 180, 90 170" fill="none" stroke={SKIN} strokeWidth="16" strokeLinecap="round" />
            <path d="M 130 120 C 150 160, 150 200, 140 230" fill="none" stroke={SKIN} strokeWidth="16" strokeLinecap="round" />
            {/* Phone */}
            <rect x="75" y="150" width="24" height="40" rx="4" fill="#333" />
            <rect x="78" y="153" width="18" height="34" rx="2" fill="#fff" />
          </>
        )}
        {pose === "waving" && (
          <>
            <path d="M 70 120 C 50 160, 50 200, 60 230" fill="none" stroke={SKIN} strokeWidth="16" strokeLinecap="round" />
            <path d="M 130 120 C 160 80, 150 50, 160 30" fill="none" stroke={SKIN} strokeWidth="16" strokeLinecap="round" />
            <motion.path d="M 170 30 C 180 20, 180 40, 190 30" fill="none" stroke="#333" strokeWidth="2"
              animate={{ opacity: [0, 1, 0], x: [0, 5, 0] }} transition={{ repeat: Infinity, duration: 0.5 }} />
          </>
        )}

        {/* Neck (drawn before head so jaw covers it) */}
        <rect x="92" y="95" width="16" height="22" fill={SKIN} />

        {/* Hair — solid dome behind face. Top arc rises to y≈30 (control y=15) and covers the full crown from x=50 to x=150. */}
        <path
          d="M 50 140 C 42 15, 158 15, 150 140 L 128 140 C 128 120, 122 110, 100 110 C 78 110, 72 120, 72 140 Z"
          fill={HAIR}
        />

        {/* Face (skin oval — drawn over the hair so face is visible) */}
        <ellipse cx="100" cy="75" rx="28" ry="32" fill={SKIN} />

        {/* Bangs — single arc across the forehead (no center V split) so no skin shows above the eyebrows. Peaks at y≈40, well above face-top y=43. */}
        <path
          d="M 64 62 C 68 32, 132 32, 136 62 L 134 74 C 128 67, 118 65, 108 68 C 100 71, 92 68, 82 66 C 72 65, 66 68, 66 74 Z"
          fill={HAIR}
        />

        {/* Eyebrows */}
        <path d="M 84 64 Q 89 62 94 65" stroke="#3b1f0e" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <path d="M 106 65 Q 111 62 116 64" stroke="#3b1f0e" strokeWidth="1.6" fill="none" strokeLinecap="round" />

        {/* Eyes */}
        <ellipse cx="89" cy="73" rx="2.5" ry="3" fill="#222" />
        <ellipse cx="111" cy="73" rx="2.5" ry="3" fill="#222" />
        {/* Eye highlights */}
        <circle cx="89.6" cy="72" r="0.7" fill="#fff" />
        <circle cx="111.6" cy="72" r="0.7" fill="#fff" />

        {/* Cheeks */}
        <circle cx="80" cy="84" r="3.5" fill="#f59e0b" opacity="0.25" />
        <circle cx="120" cy="84" r="3.5" fill="#f59e0b" opacity="0.25" />

        {/* Mouth */}
        {expression === "smile" && (
          <path d="M 92 88 Q 100 95 108 88" fill="none" stroke="#5a2a18" strokeWidth="2" strokeLinecap="round" />
        )}
        {expression === "talking" && (
          <motion.ellipse cx="100" cy="90" rx="5" ry="3" fill="#5a2a18"
            animate={{ ry: [1.5, 4, 1.5] }} transition={{ repeat: Infinity, duration: 0.3 }} />
        )}
      </svg>
    </div>
  );
}
