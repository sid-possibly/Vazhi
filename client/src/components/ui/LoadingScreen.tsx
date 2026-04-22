import { useEffect, useState, useRef } from 'react';
import gsap from 'gsap';

const VAZHI_VARIANTS = ["വഴി", "રસ્તો", "வழி", "ದಾರಿ", "ਰਾਹ", "మార్గం", "ବାଟ", "मार्ग", "পথ", "Vazhi"];

export default function LoadingScreen({ onComplete }: { onComplete: () => void }) {
  const [index, setIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // 1. Language Cycling Logic
    const interval = setInterval(() => {
      setIndex((prev) => {
        if (prev < VAZHI_VARIANTS.length - 1) return prev + 1;
        clearInterval(interval);
        return prev;
      });
    }, 250);

    // 2. Clean Exit Animation
    if (index === VAZHI_VARIANTS.length - 1) {
      const tl = gsap.timeline({
        onComplete: () => onComplete(),
      });

      tl.to({}, { duration: 0.5 }) 
        .to(containerRef.current, {
          opacity: 0,
          duration: 2,
          ease: "power3.inOut",
        });
    }

    return () => clearInterval(interval);
  }, [index, onComplete]);

  return (
    <div ref={containerRef} className="loading-wrapper bg-[#020617] flex items-center justify-center w-full h-full fixed inset-0 z-[100]">
      {/* Subtle Background Glow */}
      <div className="absolute h-48 w-48 rounded-full bg-teal-500/10 blur-[100px]" />

      {/* Main Flex Container */}
      <div className="z-10 flex flex-col items-center justify-center gap-16">
        
        {/* Main Text Container */}
        <div className="h-[120px] flex items-center justify-center">
          <h1 
            ref={textRef}
            className="text-5xl md:text-7xl font-black tracking-tighter text-white leading-none"
          >
            <span className="bg-gradient-to-t from-teal-400 to-white bg-clip-text text-transparent">
              {VAZHI_VARIANTS[index]}
            </span>
            {index === VAZHI_VARIANTS.length - 1 && <span className="text-blue-500">.</span>}
          </h1>
        </div>
        
        {/* Loading Elements */}
        <div className="flex flex-col items-center gap-6">
          <div className="h-[1px] w-24 overflow-hidden bg-slate-800/50">
            <div 
              className="h-full bg-teal-500 transition-all duration-200 ease-out"
              style={{ width: `${((index + 1) / VAZHI_VARIANTS.length) * 100}%` }}
            />
          </div>

          <p className="text-teal-500/40 tracking-[0.5em] text-[10px] md:text-xs uppercase font-mono">
            Initializing Live Intelligence
          </p>
        </div>

      </div>
    </div>
  );
}