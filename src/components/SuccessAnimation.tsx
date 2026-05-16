import { useEffect, useMemo, useState } from 'react';

interface SuccessAnimationProps {
  show: boolean;
}

const CONFETTI_COLORS = ['#B85C3A', '#2D3A6E', '#C9A96E', '#8B6F5C', '#D4845E'];

interface Particle {
  id: number;
  x: number;
  color: string;
  delay: number;
  size: number;
}

export default function SuccessAnimation({ show }: SuccessAnimationProps) {
  const [visible, setVisible] = useState(false);

  const particles = useMemo<Particle[]>(() => {
    if (!show) return [];
    return Array.from({ length: 20 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      delay: Math.random() * 0.5,
      size: 4 + Math.random() * 6,
    }));
  }, [show]);

  useEffect(() => {
    if (show) {
      setVisible(true);
      const timer = setTimeout(() => setVisible(false), 2500);
      return () => clearTimeout(timer);
    }
  }, [show]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {particles.map((p) => (
        <div
          key={p.id}
          className="absolute top-0"
          style={{
            left: `${p.x}%`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            backgroundColor: p.color,
            borderRadius: p.id % 3 === 0 ? '50%' : '2px',
            animation: `confettiFall 2s ease-in ${p.delay}s both`,
          }}
        />
      ))}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="animate-success-pop">
          <div className="w-20 h-20 rounded-full bg-secondary/20 flex items-center justify-center">
            <div className="w-14 h-14 rounded-full bg-secondary flex items-center justify-center">
              <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
