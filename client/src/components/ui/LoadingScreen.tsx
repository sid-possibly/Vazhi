import { useEffect, useRef } from 'react';
import gsap from 'gsap';

export default function LoadingScreen({ onComplete }: { onComplete: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const tl = gsap.timeline({
      onComplete: () => onComplete(),
    });

    // Initial state: Hidden and slightly shifted down
    tl.set(textRef.current, { opacity: 0, y: 20 })
      // Animate In: "Coming to Life"
      .to(textRef.current, { 
        opacity: 1, 
        y: 0, 
        duration: 1.5, 
        ease: "power4.out" 
      })
      // Hold for a beat
      .to({}, { duration: 1 })
      // Animate Out: The "Reveal"
      .to(containerRef.current, {
        opacity: 0,
        duration: 1,
        ease: "power2.inOut",
      });
  }, [onComplete]);

  return (
    <div ref={containerRef} className="loading-wrapper">
      <div className="text-center">
        <h1 
          ref={textRef}
          className="text-6xl md:text-8xl font-black tracking-tighter text-white"
        >
          VAZHI <span className="text-blue-500">.</span>
        </h1>
        <p className="text-gray-500 mt-4 tracking-[0.5em] text-sm uppercase">
          Kerala Transit Intelligence
        </p>
      </div>
    </div>
  );
}